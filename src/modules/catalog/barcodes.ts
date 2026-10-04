import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { decimalString } from "@/modules/inventory/money";

export async function listBarcodes(organizationId: string) {
  const rows = await prisma.productBarcode.findMany({
    where: { organizationId, product: { deletedAt: null } },
    orderBy: { barcode: "asc" },
    take: 200,
    select: { id: true, barcode: true, product: { select: { sku: true, name: true, sellingPrice: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    barcode: row.barcode,
    sku: row.product.sku,
    product: row.product.name,
    sellingPrice: decimalString(row.product.sellingPrice, 2),
  }));
}

export async function recordBarcodePrint(input: {
  organizationId: string;
  userId: string;
  barcodeId: string;
  copies: number;
  ip: string;
  userAgent: string | null;
}) {
  if (!Number.isInteger(input.copies) || input.copies < 1 || input.copies > 50) {
    return { ok: false as const, status: 422 as const, message: "Enter 1 to 50 copies." };
  }
  const barcode = await prisma.productBarcode.findFirst({
    where: { id: input.barcodeId, organizationId: input.organizationId, product: { deletedAt: null } },
    select: { id: true, barcode: true, product: { select: { name: true, sellingPrice: true } } },
  });
  if (!barcode) {
    return { ok: false as const, status: 404 as const, message: "That record was not found." };
  }
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "print",
    module: "products",
    entityType: "barcode",
    entityId: barcode.id,
    after: { barcode: barcode.barcode, product: barcode.product.name, copies: input.copies },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return {
    ok: true as const,
    barcode: barcode.barcode,
    product: barcode.product.name,
    sellingPrice: decimalString(barcode.product.sellingPrice, 2),
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
    const record = after as { barcode?: string; product?: string; copies?: number };
    return {
      id: row.id,
      occurredOn: row.createdAt.toISOString().slice(0, 10),
      barcode: record.barcode ?? "",
      product: record.product ?? "",
      copies: String(record.copies ?? ""),
      user: row.user?.name ?? "",
    };
  });
}
