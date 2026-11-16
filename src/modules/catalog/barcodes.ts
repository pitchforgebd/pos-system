import { RuleError } from "@/core/errors/rule-error";
import { prisma } from "@/lib/db/client";
import { businessDate } from "@/core/time/business-date";
import { writeAudit } from "@/modules/auth/audit";
import { decimalString } from "@/core/money";
import { pricesFor } from "@/modules/pricing";

/**
 * Label layouts. A4: an office printer, 3 (A4) or 5 (A4_SMALL) labels across. LABEL_*: a thermal label printer, one label a page at that
 * size in millimetres. LABEL_2UP_38X25: a thermal roll with two 38 x 25 mm labels side by side.
 */
export const LABEL_FORMATS = ["A4", "A4_SMALL", "LABEL_38X25", "LABEL_50X25", "LABEL_40X30", "LABEL_50X30", "LABEL_2UP_38X25"] as const;
export type LabelFormat = (typeof LABEL_FORMATS)[number];

/** What each product sells for at one level, one unit (the price on its label). Missing: the product has no price. */
async function labelPrices(organizationId: string, productIds: string[], levelName?: string) {
  try {
    const found = await pricesFor(prisma, { organizationId, productIds, level: levelName });
    const prices = new Map<string, string>();
    for (const [productId, entry] of found.byProduct) {
      prices.set(productId, decimalString(entry.picked?.price ?? entry.sellingPrice, 2));
    }
    return { prices, level: found.levelName };
  } catch (error) {
    if (error instanceof RuleError) {
      return null;
    }
    throw error;
  }
}

export async function listBarcodes(organizationId: string, options: { level?: string; search?: string } = {}) {
  const needle = options.search?.trim();
  const rows = await prisma.productBarcode.findMany({
    where: {
      organizationId,
      product: { deletedAt: null },
      ...(needle ? { OR: [{ barcode: { contains: needle } }, { product: { name: { contains: needle } } }, { product: { sku: { contains: needle } } }] } : {}),
    },
    orderBy: { barcode: "asc" },
    take: 200,
    select: { id: true, barcode: true, productId: true, product: { select: { sku: true, name: true, sellingPrice: true } } },
  });
  const priced = await labelPrices(organizationId, [...new Set(rows.map((row) => row.productId))], options.level);
  return rows.map((row) => ({
    id: row.id,
    barcode: row.barcode,
    sku: row.product.sku,
    product: row.product.name,
    price: priced?.prices.get(row.productId) ?? decimalString(row.product.sellingPrice, 2),
    /** Kept for the screens that were written when a label had one price. */
    sellingPrice: priced?.prices.get(row.productId) ?? decimalString(row.product.sellingPrice, 2),
  }));
}

export async function recordBarcodePrint(input: {
  organizationId: string;
  userId: string;
  barcodeId: string;
  copies: number;
  level?: string;
  format?: LabelFormat;
  ip: string;
  userAgent: string | null;
}) {
  if (!Number.isInteger(input.copies) || input.copies < 1 || input.copies > 300) {
    return { ok: false as const, status: 422 as const, message: "Enter 1 to 300 copies." };
  }
  const format = input.format ?? "A4";
  if (!LABEL_FORMATS.includes(format)) {
    return { ok: false as const, status: 422 as const, message: "Choose a label layout from the list." };
  }
  const barcode = await prisma.productBarcode.findFirst({
    where: { id: input.barcodeId, organizationId: input.organizationId, product: { deletedAt: null } },
    select: { id: true, barcode: true, productId: true, product: { select: { name: true, sku: true, sellingPrice: true } } },
  });
  const shop = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } });
  if (!barcode) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  const priced = await labelPrices(input.organizationId, [barcode.productId], input.level);
  if (!priced) {
    return { ok: false as const, status: 422 as const, message: "That price level does not exist." };
  }
  const price = priced.prices.get(barcode.productId) ?? decimalString(barcode.product.sellingPrice, 2);
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "print",
    module: "products",
    entityType: "barcode",
    entityId: barcode.id,
    after: { barcode: barcode.barcode, product: barcode.product.name, copies: input.copies, level: priced.level, format, price },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return {
    ok: true as const,
    barcode: barcode.barcode,
    product: barcode.product.name,
    sellingPrice: price,
    sku: barcode.product.sku,
    shop: shop?.name ?? "",
    level: priced.level,
    format,
    copies: input.copies,
  };
}

export async function listBarcodePrints(organizationId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { organizationId, module: "products", action: "print", entityType: "barcode" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, createdAt: true, after: true, user: { select: { name: true } } },
  });
  return rows.map((row) => {
    const after = row.after && typeof row.after === "object" && !Array.isArray(row.after) ? row.after : {};
    const record = after as { barcode?: string; product?: string; copies?: number; level?: string; format?: string };
    return {
      id: row.id,
      businessDate: businessDate(row.createdAt),
      barcode: record.barcode ?? "",
      product: record.product ?? "",
      copies: String(record.copies ?? ""),
      level: record.level ?? "",
      format: record.format ?? "",
      user: row.user?.name ?? "",
    };
  });
}
