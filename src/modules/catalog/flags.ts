import { prisma } from "@/lib/db/client";
import { decimalString } from "@/core/money";

const productSelect = { id: true, sku: true, name: true, vatType: true, vatValue: true } as const;

export async function listProductVat(organizationId: string) {
  const rows = await prisma.product.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { name: "asc" },
    take: 100,
    select: productSelect,
  });
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    vatType: row.vatType ?? "",
    vatValue: row.vatValue === null ? "" : decimalString(row.vatValue, 4),
  }));
}

export async function listSerialProducts(organizationId: string) {
  const rows = await prisma.product.findMany({
    where: { organizationId, deletedAt: null, trackSerial: true },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, sku: true, name: true },
  });
  return rows;
}

export async function listWarrantyProducts(organizationId: string) {
  const rows = await prisma.product.findMany({
    where: { organizationId, deletedAt: null, warrantyAvailable: true },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, sku: true, name: true },
  });
  return rows;
}
