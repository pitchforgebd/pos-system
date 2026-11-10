import { Prisma } from "@prisma/client";

import { RuleError } from "@/core/errors/rule-error";
import { decimalString } from "@/core/money";
import { dateOnly } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { ensurePriceLevels, setPrices, type PriceStep } from "@/modules/pricing";

// The product page (P04 task 3, H9): everything about one product in one read. What the product cost (the list purchase price, the
// average cost of the stock, the margin) is business-confidential (D20): it is only included for someone who holds products.cost.

const dec = (value: unknown) => new Prisma.Decimal(String(value ?? 0));

export type PriceLevelSteps = { level: string; isDefault: boolean; steps: Array<{ minQty: string; price: string }> };

export type ProductDetail = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  description: string | null;
  genericName: string | null;
  status: "ACTIVE" | "INACTIVE";
  isService: boolean;
  unit: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  vatType: string | null;
  vatValue: string | null;
  sellingPrice: string;
  wholesalePrice: string;
  minimumPrice: string;
  reorderLevel: string;
  trackStock: boolean;
  trackExpiry: boolean;
  trackSerial: boolean;
  warrantyAvailable: boolean;
  images: Array<{ id: string }>;
  barcodes: Array<{ id: string; barcode: string; variantId: string | null }>;
  variants: Array<{ id: string; sku: string; price: string | null; values: string[] }>;
  levels: PriceLevelSteps[];
  stock: Array<{ warehouseId: string; warehouseName: string; branchName: string; quantity: string; reserved: string }>;
  onHand: string;
  ledger: Array<{ id: string; date: string; movementType: string; direction: string; quantity: string; warehouseName: string }>;
  /** Only with products.cost: */
  cost?: {
    purchasePrice: string;
    averageCost: string | null;
    stockValue: string;
    /** (retail price - average cost) / retail price, in percent. */
    marginPercent: string | null;
    stock: Array<{ warehouseId: string; averageCost: string | null; value: string }>;
  };
};

export async function getProductDetail(organizationId: string, productId: string, options: { cost: boolean }): Promise<ProductDetail | null> {
  const row = await prisma.product.findFirst({
    where: { id: productId, organizationId, deletedAt: null },
    include: {
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      unit: { select: { id: true, name: true } },
      images: { select: { id: true }, orderBy: { createdAt: "asc" } },
      barcodes: { select: { id: true, barcode: true, variantId: true }, orderBy: { createdAt: "asc" } },
      variants: { select: { id: true, sku: true, price: true, values: { select: { head: { select: { name: true } }, value: { select: { value: true } } } } }, orderBy: { sku: "asc" } },
    },
  });
  if (!row) {
    return null;
  }
  const [{ levels }, prices, balances, ledger] = await Promise.all([
    ensurePriceLevels(prisma, organizationId),
    prisma.productPrice.findMany({ where: { organizationId, productId, variantScope: "" }, orderBy: { minQty: "asc" } }),
    prisma.stockBalance.findMany({
      where: { organizationId, productId },
      select: { warehouseId: true, quantity: true, reservedQty: true, averageCost: true, warehouse: { select: { name: true, branch: { select: { name: true } } } } },
      orderBy: { warehouse: { name: "asc" } },
    }),
    prisma.stockLedger.findMany({
      where: { organizationId, productId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: { id: true, businessDate: true, movementType: true, direction: true, quantity: true, warehouse: { select: { name: true } } },
    }),
  ]);
  const onHand = balances.reduce((total, balance) => total.plus(balance.quantity), dec(0));
  const value = balances.reduce((total, balance) => total.plus(dec(balance.quantity).mul(balance.averageCost ?? 0).toDecimalPlaces(2)), dec(0));
  const averageCost = onHand.gt(0) ? value.div(onHand).toDecimalPlaces(4) : null;
  const detail: ProductDetail = {
    id: row.id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    description: row.description,
    genericName: row.genericName,
    status: row.status,
    isService: row.isService,
    unit: row.unit,
    brand: row.brand,
    category: row.category,
    vatType: row.vatType,
    vatValue: row.vatValue ? decimalString(row.vatValue, 2) : null,
    sellingPrice: decimalString(row.sellingPrice, 2),
    wholesalePrice: decimalString(row.wholesalePrice, 2),
    minimumPrice: decimalString(row.minimumPrice, 2),
    reorderLevel: decimalString(row.reorderLevel, 4),
    trackStock: row.trackStock,
    trackExpiry: row.trackExpiry,
    trackSerial: row.trackSerial,
    warrantyAvailable: row.warrantyAvailable,
    images: row.images,
    barcodes: row.barcodes,
    variants: row.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      price: variant.price ? decimalString(variant.price, 2) : null,
      values: variant.values.map((entry) => `${entry.head.name}: ${entry.value.value}`),
    })),
    levels: levels.map((level) => ({
      level: level.name,
      isDefault: level.isDefault,
      steps: prices.filter((price) => price.priceLevelId === level.id).map((price) => ({ minQty: decimalString(price.minQty, 4), price: decimalString(price.price, 2) })),
    })),
    stock: balances.map((balance) => ({
      warehouseId: balance.warehouseId,
      warehouseName: balance.warehouse.name,
      branchName: balance.warehouse.branch.name,
      quantity: decimalString(balance.quantity, 4),
      reserved: decimalString(balance.reservedQty, 4),
    })),
    onHand: decimalString(onHand, 4),
    ledger: ledger.map((entry) => ({ id: entry.id, date: dateOnly(entry.businessDate), movementType: entry.movementType, direction: entry.direction, quantity: decimalString(entry.quantity, 4), warehouseName: entry.warehouse?.name ?? "" })),
  };
  if (options.cost) {
    const retail = dec(row.sellingPrice);
    detail.cost = {
      purchasePrice: decimalString(row.purchasePrice, 2),
      averageCost: averageCost ? decimalString(averageCost, 4) : null,
      stockValue: decimalString(value, 2),
      marginPercent: averageCost && retail.gt(0) ? retail.minus(averageCost).div(retail).mul(100).toDecimalPlaces(2).toFixed(2) : null,
      stock: balances.map((balance) => ({
        warehouseId: balance.warehouseId,
        averageCost: balance.averageCost ? decimalString(balance.averageCost, 4) : null,
        value: decimalString(dec(balance.quantity).mul(balance.averageCost ?? 0), 2),
      })),
    };
  }
  return detail;
}

/** The price steps of a product as the audit trail shows them: "Wholesale 10+ = 90.00". */
async function stepsAsText(organizationId: string, productId: string, variantId: string | null) {
  const rows = await prisma.productPrice.findMany({
    where: { organizationId, productId, variantScope: variantId ?? "" },
    select: { minQty: true, price: true, priceLevel: { select: { name: true } } },
    orderBy: [{ priceLevel: { sortOrder: "asc" } }, { minQty: "asc" }],
  });
  return rows.map((row) => `${row.priceLevel.name} ${decimalString(row.minQty, 4)}+ = ${decimalString(row.price, 2)}`);
}

/** Replaces the price steps of a product or one variant and records the old and new steps in the audit trail. */
export async function savePriceSteps(input: {
  organizationId: string;
  actorId: string;
  productId: string;
  variantId?: string | null;
  prices: PriceStep[];
  ip: string;
  userAgent: string | null;
}) {
  const before = await stepsAsText(input.organizationId, input.productId, input.variantId ?? null);
  try {
    await setPrices(prisma, { organizationId: input.organizationId, productId: input.productId, variantId: input.variantId, prices: input.prices });
  } catch (error) {
    if (error instanceof RuleError) {
      return { ok: false as const, status: error.status, message: error.message };
    }
    throw error;
  }
  const after = await stepsAsText(input.organizationId, input.productId, input.variantId ?? null);
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "update",
    module: "products",
    entityType: input.variantId ? "product_variant_prices" : "product_prices",
    entityId: input.variantId ?? input.productId,
    before: { steps: before },
    after: { steps: after },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const };
}
