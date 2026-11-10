import { Prisma } from "@prisma/client";

import { decimalString } from "@/core/money";
import { prisma } from "@/lib/db/client";
import { pickPrice, pricesFor } from "@/modules/pricing";

// Product search (P04 task 7, N8). The register used to load 200 products and look inside them; this asks the database, 20 rows at a
// time, by name, SKU, barcode, generic name and variant. A scanned barcode finds exactly its product (and says which variant). Each row
// comes with the price at the level, its quantity steps, and what is available. What a product cost is never in the answer.

const LIMIT = 20;

export type ProductHit = {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  unit: string | null;
  isService: boolean;
  trackSerial: boolean;
  vatType: string | null;
  vatValue: string | null;
  price: string;
  levelName: string;
  /** The price came from the default level because the chosen level had none for this quantity. */
  fellBack: boolean;
  steps: Array<{ minQty: string; price: string }>;
  /** What can be sold: on hand less what is reserved (null for a service). */
  available: string | null;
  barcodes: string[];
  variants: Array<{ id: string; sku: string; price: string }>;
  /** The variant whose barcode or SKU was the query, when it was one. */
  matchedVariantId: string | null;
  hasImage: boolean;
};

export async function searchProducts(input: {
  organizationId: string;
  q: string;
  branchId?: string | null;
  quantity?: string;
  level?: string;
  levelId?: string;
  customerTypeId?: string | null;
}): Promise<ProductHit[]> {
  const q = input.q.trim();
  if (q === "") {
    return [];
  }
  const base = { organizationId: input.organizationId, deletedAt: null, status: "ACTIVE" as const };
  // A barcode (or a variant's barcode) that matches exactly is the product being scanned: it comes alone, first.
  const exact = await prisma.productBarcode.findFirst({ where: { organizationId: input.organizationId, barcode: q, product: base }, select: { productId: true, variantId: true } });
  const found = exact
    ? await prisma.product.findMany({ where: { id: exact.productId, ...base }, select: { id: true } })
    : await prisma.product.findMany({
        where: {
          ...base,
          OR: [
            { name: { contains: q } },
            { sku: { contains: q } },
            { genericName: { contains: q } },
            { barcodes: { some: { barcode: { contains: q } } } },
            { variants: { some: { sku: { contains: q } } } },
          ],
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: LIMIT,
        select: { id: true },
      });
  const ids = found.map((row) => row.id);
  if (ids.length === 0) {
    return [];
  }
  const [products, priced, balances] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: ids }, organizationId: input.organizationId },
      select: {
        id: true, sku: true, name: true, genericName: true, isService: true, trackSerial: true, vatType: true, vatValue: true,
        unit: { select: { name: true } },
        barcodes: { select: { barcode: true, variantId: true } },
        variants: { orderBy: { sku: "asc" }, select: { id: true, sku: true, price: true } },
        images: { take: 1, select: { id: true } },
      },
    }),
    pricesFor(prisma, { organizationId: input.organizationId, productIds: ids, quantity: input.quantity, level: input.level, levelId: input.levelId, customerTypeId: input.customerTypeId }),
    prisma.stockBalance.groupBy({
      by: ["productId"],
      where: { organizationId: input.organizationId, productId: { in: ids }, ...(input.branchId ? { branchId: input.branchId } : {}) },
      _sum: { quantity: true, reservedQty: true },
    }),
  ]);
  const available = new Map(balances.map((row) => [row.productId, new Prisma.Decimal(row._sum.quantity ?? 0).minus(row._sum.reservedQty ?? 0)]));
  const byId = new Map(products.map((product) => [product.id, product]));
  const quantity = new Prisma.Decimal(input.quantity ?? "1");
  return ids.flatMap((id) => {
    const product = byId.get(id);
    const entry = priced.byProduct.get(id);
    if (!product || !entry) {
      return [];
    }
    const matchedVariant =
      exact?.productId === id && exact.variantId
        ? exact.variantId
        : (product.variants.find((variant) => variant.sku.toLowerCase() === q.toLowerCase())?.id ?? null);
    const price = entry.picked?.price ?? entry.sellingPrice;
    return [
      {
        id,
        sku: product.sku,
        name: product.name,
        genericName: product.genericName,
        unit: product.unit?.name ?? null,
        isService: product.isService,
        trackSerial: product.trackSerial,
        vatType: product.vatType,
        vatValue: product.vatValue ? decimalString(product.vatValue, 2) : null,
        price: decimalString(price, 2),
        levelName: priced.levels.find((level) => level.id === (entry.picked?.levelId ?? priced.levelId))?.name ?? priced.levelName,
        fellBack: entry.picked?.fellBack ?? false,
        steps: entry.steps.map((step) => ({ minQty: step.minQty.toFixed(step.minQty.isInteger() ? 0 : 4), price: decimalString(step.price, 2) })),
        available: product.isService ? null : decimalString(available.get(id) ?? new Prisma.Decimal(0), 4),
        barcodes: product.barcodes.map((barcode) => barcode.barcode),
        variants: product.variants.map((variant) => {
          const own = pickPrice({ rows: entry.rows, variantId: variant.id, levelId: priced.levelId, defaultLevelId: priced.defaultLevelId, quantity, minimumPrice: entry.minimumPrice });
          return { id: variant.id, sku: variant.sku, price: decimalString(own?.price ?? variant.price ?? price, 2) };
        }),
        matchedVariantId: matchedVariant,
        hasImage: product.images.length > 0,
      },
    ];
  });
}
