import { Prisma } from "@prisma/client";

import { MONEY_KINDS } from "@/core/ledger/accounts";
import { decimalString } from "@/core/money";
import { prisma } from "@/lib/db/client";

// What the purchase forms pick from: the products that can be bought (with what they cost last time), and the accounts money can be paid from.

export type Purchasable = {
  id: string;
  sku: string;
  name: string;
  unit: string | null;
  trackExpiry: boolean;
  trackSerial: boolean;
  /** What the last received purchase paid for a unit (four decimals), or the product's purchase price when it was never bought. */
  lastCost: string;
  lastSupplierId: string | null;
};

const LIMIT = 20;

/** Up to 20 products that hold stock, found by name, SKU or barcode in the database, with what they cost the last time. */
export async function searchPurchasable(organizationId: string, q: string): Promise<Purchasable[]> {
  const text = q.trim();
  if (text === "") {
    return [];
  }
  const products = await prisma.product.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: "ACTIVE",
      trackStock: true,
      OR: [{ name: { contains: text } }, { sku: { contains: text } }, { barcodes: { some: { barcode: { contains: text } } } }],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: LIMIT,
    select: { id: true, sku: true, name: true, trackExpiry: true, trackSerial: true, purchasePrice: true, unit: { select: { name: true } } },
  });
  if (products.length === 0) {
    return [];
  }
  const last = await prisma.$queryRaw<Array<{ productId: string; unitCost: Prisma.Decimal; supplierId: string }>>`
    SELECT pi.productId AS productId, pi.unitCost AS unitCost, pu.supplierId AS supplierId
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchaseId AND pu.status = 'RECEIVED'
    WHERE pi.organizationId = ${organizationId} AND pi.productId IN (${Prisma.join(products.map((product) => product.id))})
      AND NOT EXISTS (
        SELECT 1 FROM purchase_items pi2 JOIN purchases pu2 ON pu2.id = pi2.purchaseId AND pu2.status = 'RECEIVED'
        WHERE pi2.productId = pi.productId AND pi2.organizationId = pi.organizationId
          AND (pu2.receivedOn > pu.receivedOn OR (pu2.receivedOn = pu.receivedOn AND pu2.createdAt > pu.createdAt))
      )
  `;
  const byProduct = new Map(last.map((row) => [row.productId, row]));
  return products.map((product) => {
    const row = byProduct.get(product.id);
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      unit: product.unit?.name ?? null,
      trackExpiry: product.trackExpiry,
      trackSerial: product.trackSerial,
      lastCost: row ? decimalString(row.unitCost, 4) : decimalString(product.purchasePrice, 4),
      lastSupplierId: row?.supplierId ?? null,
    };
  });
}

/** The branch's active warehouses, for choosing where the goods go. */
export async function warehouseOptions(organizationId: string, branchId: string) {
  return prisma.warehouse.findMany({ where: { organizationId, branchId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export type MoneyAccountOption = { id: string; code: string; name: string; kind: "CASH" | "BANK" | "MOBILE" };

/** The cash drawers, bank accounts and mobile wallets money can be paid from or received into. */
export async function moneyAccountOptions(organizationId: string): Promise<MoneyAccountOption[]> {
  const rows = await prisma.account.findMany({
    where: { organizationId, status: "ACTIVE", kind: { in: [...MONEY_KINDS] } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, kind: true },
  });
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, kind: row.kind as MoneyAccountOption["kind"] }));
}
