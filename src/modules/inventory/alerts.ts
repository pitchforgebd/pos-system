import { Prisma } from "@prisma/client";

import { pageInfo, type ListQuery, type Paged } from "@/core/list";
import { decimalString } from "@/core/money";
import { addDays, businessDate, dateOnly, daysBetween } from "@/core/time/business-date";
import { prisma } from "@/lib/db/client";
import { alertStatus } from "@/modules/inventory/stock";

// Stock alerts (P03 task 9, N18). Low stock is found in SQL, not by cutting a list at 200 rows and filtering what is left, so every
// low product is reachable and counts in the sidebar badge. A row is low when its quantity is at or below the product's reorder
// level (out of stock when it is zero).

const dec = (value: unknown) => new Prisma.Decimal(String(value ?? 0));

type Filter = { organizationId: string; branchId: string; search?: string; brandId?: string; categoryId?: string };

function where(input: Filter) {
  const needle = input.search?.trim();
  return Prisma.sql`
    sb.organizationId = ${input.organizationId} AND sb.branchId = ${input.branchId}
    AND p.deletedAt IS NULL AND p.trackStock = 1 AND sb.quantity <= p.reorderLevel
    ${needle ? Prisma.sql`AND (p.name LIKE ${`%${needle}%`} OR p.sku LIKE ${`%${needle}%`})` : Prisma.empty}
    ${input.brandId ? Prisma.sql`AND p.brandId = ${input.brandId}` : Prisma.empty}
    ${input.categoryId ? Prisma.sql`AND p.categoryId = ${input.categoryId}` : Prisma.empty}`;
}

export type LowStockRow = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  brandId: string | null;
  categoryId: string | null;
  warehouseName: string;
  quantity: string;
  reorderLevel: string;
  alert: "LOW" | "OUT_OF_STOCK";
};

/** One page of the low and out-of-stock rows of a branch, out of stock first, then the emptiest. */
export async function listLowStock(input: Filter & { query: ListQuery }): Promise<Paged<LowStockRow>> {
  const [count] = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*) AS total FROM stock_balances sb JOIN products p ON p.id = sb.productId WHERE ${where(input)}`;
  const total = Number(count?.total ?? 0);
  const rows = await prisma.$queryRaw<
    Array<{ id: string; productId: string; sku: string; name: string; brandId: string | null; categoryId: string | null; warehouseName: string; quantity: Prisma.Decimal; reorderLevel: Prisma.Decimal }>
  >`
    SELECT sb.id AS id, sb.productId AS productId, p.sku AS sku, p.name AS name, p.brandId AS brandId, p.categoryId AS categoryId,
           w.name AS warehouseName, sb.quantity AS quantity, p.reorderLevel AS reorderLevel
    FROM stock_balances sb
    JOIN products p ON p.id = sb.productId
    JOIN warehouses w ON w.id = sb.warehouseId
    WHERE ${where(input)}
    ORDER BY (sb.quantity > 0) ASC, sb.quantity ASC, p.name ASC, sb.id ASC
    LIMIT ${input.query.take} OFFSET ${input.query.skip}`;
  return {
    rows: rows.map((row) => {
      const quantity = dec(row.quantity);
      return {
        id: row.id,
        productId: row.productId,
        sku: row.sku,
        name: row.name,
        brandId: row.brandId,
        categoryId: row.categoryId,
        warehouseName: row.warehouseName,
        quantity: decimalString(quantity, 4),
        reorderLevel: decimalString(row.reorderLevel, 4),
        alert: alertStatus(quantity, dec(row.reorderLevel)) === "OUT_OF_STOCK" ? ("OUT_OF_STOCK" as const) : ("LOW" as const),
      };
    }),
    page: pageInfo(total, input.query, rows.length),
  };
}

/** How many rows of the branch are low or out of stock: the sidebar badge. */
export async function lowStockCount(organizationId: string, branchId: string) {
  const [row] = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*) AS total FROM stock_balances sb JOIN products p ON p.id = sb.productId WHERE ${where({ organizationId, branchId })}`;
  return Number(row?.total ?? 0);
}

export type ReorderRow = {
  productId: string;
  sku: string;
  name: string;
  onHand: string;
  reorderLevel: string;
  lastVendor: string;
  /** Who the last received purchase of it was from (null when it was never bought). */
  lastVendorId: string | null;
  lastCost: string;
  /** Sold in the last 30 days. */
  sold30: string;
  avgPerDay: string;
  /** Enough for the next 30 days at the recent selling rate, or twice the reorder level, whichever is more, less what is on hand. */
  suggested: string;
};

/** What to buy: the low products with the last vendor and price, what sold in 30 days, and a suggested quantity. */
export async function reorderList(organizationId: string, branchId: string, limit = 200): Promise<ReorderRow[]> {
  const rows = await prisma.$queryRaw<Array<{ productId: string; sku: string; name: string; onHand: Prisma.Decimal; reorderLevel: Prisma.Decimal }>>`
    SELECT sb.productId AS productId, p.sku AS sku, p.name AS name, SUM(sb.quantity) AS onHand, p.reorderLevel AS reorderLevel
    FROM stock_balances sb JOIN products p ON p.id = sb.productId
    WHERE ${where({ organizationId, branchId })}
    GROUP BY sb.productId, p.sku, p.name, p.reorderLevel
    ORDER BY SUM(sb.quantity) ASC, p.name ASC
    LIMIT ${limit}`;
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.productId);
  const purchases = await prisma.$queryRaw<Array<{ productId: string; unitCost: Prisma.Decimal; supplierName: string; supplierId: string }>>`
    SELECT pi.productId AS productId, pi.unitCost AS unitCost, s.name AS supplierName, s.id AS supplierId
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchaseId
    JOIN suppliers s ON s.id = pu.supplierId
    WHERE pi.organizationId = ${organizationId} AND pu.branchId = ${branchId} AND pu.status = 'RECEIVED' AND pi.productId IN (${Prisma.join(ids)})
    ORDER BY pu.businessDate DESC, pu.createdAt DESC`;
  const last = new Map<string, { unitCost: Prisma.Decimal; supplierName: string; supplierId: string }>();
  for (const row of purchases) {
    if (!last.has(row.productId)) {
      last.set(row.productId, row);
    }
  }
  const since = new Date(`${addDays(businessDate(), -30)}T00:00:00.000Z`);
  const sales = await prisma.$queryRaw<Array<{ productId: string; sold: Prisma.Decimal }>>`
    SELECT productId, SUM(quantity) AS sold FROM stock_ledgers
    WHERE organizationId = ${organizationId} AND branchId = ${branchId} AND movementType = 'SALE' AND direction = 'OUT'
      AND businessDate >= ${since} AND productId IN (${Prisma.join(ids)})
    GROUP BY productId`;
  const sold = new Map(sales.map((row) => [row.productId, dec(row.sold)]));
  return rows.map((row) => {
    const onHand = dec(row.onHand);
    const reorder = dec(row.reorderLevel);
    const soldLately = sold.get(row.productId) ?? dec(0);
    const target = Prisma.Decimal.max(reorder.mul(2), soldLately);
    const suggested = Prisma.Decimal.max(target.minus(onHand), 0).ceil();
    const vendor = last.get(row.productId);
    return {
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      onHand: decimalString(onHand, 4),
      reorderLevel: decimalString(reorder, 4),
      lastVendor: vendor?.supplierName ?? "",
      lastVendorId: vendor?.supplierId ?? null,
      lastCost: vendor ? decimalString(vendor.unitCost, 4) : "",
      sold30: decimalString(soldLately, 4),
      avgPerDay: soldLately.div(30).toDecimalPlaces(2).toFixed(2),
      suggested: suggested.toFixed(0),
    };
  });
}

export type ExpiryBucket = { label: string; lots: number; quantity: string };
export type ExpiryLot = { id: string; lot: string; sku: string; name: string; warehouseName: string; quantity: string; expiresOn: string; daysLeft: number; bucket: string };

/** Lots that are expired or expire within 30, 60 and 90 days (only lots that still hold stock). */
export async function expiryWarnings(organizationId: string, branchId: string, asOf = businessDate()) {
  const horizon = new Date(`${addDays(asOf, 90)}T00:00:00.000Z`);
  const rows = await prisma.expiryBatch.findMany({
    where: { organizationId, branchId, quantity: { gt: 0 }, expiresOn: { lte: horizon }, product: { deletedAt: null } },
    orderBy: [{ expiresOn: "asc" }, { id: "asc" }],
    take: 500,
    select: { id: true, lot: true, quantity: true, expiresOn: true, product: { select: { sku: true, name: true } }, warehouse: { select: { name: true } } },
  });
  const names = ["Expired", "Within 30 days", "31-60 days", "61-90 days"];
  const bucketOf = (daysLeft: number) => (daysLeft < 0 ? 0 : daysLeft <= 30 ? 1 : daysLeft <= 60 ? 2 : 3);
  const buckets = names.map((label) => ({ label, lots: 0, total: dec(0) }));
  const lots: ExpiryLot[] = rows.map((row) => {
    const expiresOn = dateOnly(row.expiresOn);
    const daysLeft = daysBetween(asOf, expiresOn);
    const bucket = bucketOf(daysLeft);
    buckets[bucket].lots += 1;
    buckets[bucket].total = buckets[bucket].total.plus(row.quantity);
    return {
      id: row.id,
      lot: row.lot,
      sku: row.product.sku,
      name: row.product.name,
      warehouseName: row.warehouse.name,
      quantity: decimalString(row.quantity, 4),
      expiresOn,
      daysLeft,
      bucket: names[bucket],
    };
  });
  return { buckets: buckets.map((b) => ({ label: b.label, lots: b.lots, quantity: decimalString(b.total, 4) })), lots };
}
