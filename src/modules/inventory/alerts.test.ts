import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { listQuery } from "../../core/list/index.ts";
import { addDays, businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { postPurchase } from "../purchasing/purchases.ts";
import { postSale } from "../sales/sales.ts";
import { postOpeningStock } from "./documents.ts";
import { expiryWarnings, listLowStock, lowStockCount, reorderList } from "./alerts.ts";

// P03 task 9 (N18): the low-stock list filters in SQL and pages (it used to cut the list at 200 and filter afterwards), the sidebar
// badge counts them, the reorder list says what to buy and from whom, and lots near their expiry are warned about at 30, 60 and 90 days.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const who = (t: T) => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, warehouseId: t.warehouse.id, ip: "127.0.0.1", userAgent: "test" });
const open = (t: T, lines: Array<Record<string, unknown>>) => postOpeningStock({ ...who(t), idempotencyKey: randomUUID(), businessDate: today(), lines } as Parameters<typeof postOpeningStock>[0]);

async function product(t: T, name: string, reorderLevel: string, extra: Record<string, unknown> = {}) {
  const key = name.toLowerCase();
  return factories(t).product({ name, sku: `ALR-${key}`, slug: key, reorderLevel, ...extra } as never);
}

test("low and out-of-stock rows are found in SQL, newest worry first, and paged", async () => {
  await withTestOrg(async (t) => {
    const fine = await product(t, "Fine", "5");
    const low = await product(t, "Low", "5");
    const out = await product(t, "Out", "5");
    assert.equal((await open(t, [{ productId: fine.id, quantity: "50", unitCost: "1" }, { productId: low.id, quantity: "3", unitCost: "1" }, { productId: out.id, quantity: "1", unitCost: "1" }])).ok, true);
    await prisma.stockBalance.updateMany({ where: { organizationId: t.org.id, productId: out.id }, data: { quantity: 0 } });

    const page = await listLowStock({ organizationId: t.org.id, branchId: t.branch.id, query: listQuery({}) });
    assert.deepEqual(page.rows.map((r) => [r.name, r.alert]), [["Out", "OUT_OF_STOCK"], ["Low", "LOW"]], "out of stock first, the fine product is not listed");
    assert.equal(page.page.total, 2);
    assert.equal(await lowStockCount(t.org.id, t.branch.id), 2);

    const first = await listLowStock({ organizationId: t.org.id, branchId: t.branch.id, query: listQuery({ pageSize: 1 }) });
    const second = await listLowStock({ organizationId: t.org.id, branchId: t.branch.id, query: listQuery({ pageSize: 1, page: 2 }) });
    assert.deepEqual([first.rows.length, second.rows.length, first.page.pageCount, first.rows[0].name, second.rows[0].name], [1, 1, 2, "Out", "Low"]);
    const searched = await listLowStock({ organizationId: t.org.id, branchId: t.branch.id, search: "Low", query: listQuery({}) });
    assert.deepEqual(searched.rows.map((r) => r.name), ["Low"]);
  });
});

test("more than 200 low products are all reachable (the old list cut at 200 before filtering)", async () => {
  await withTestOrg(async (t) => {
    const rows = Array.from({ length: 230 }, (_, i) => ({ organizationId: t.org.id, sku: `BULK-${i}`, name: `Bulk ${String(i).padStart(3, "0")}`, slug: `bulk-${i}`, purchasePrice: "1", sellingPrice: "2", wholesalePrice: "2", minimumPrice: "1", reorderLevel: "10", trackStock: true, trackExpiry: false, trackBatch: false, trackSerial: false }));
    await prisma.product.createMany({ data: rows });
    const products = await prisma.product.findMany({ where: { organizationId: t.org.id }, select: { id: true } });
    await prisma.stockBalance.createMany({ data: products.map((p) => ({ organizationId: t.org.id, productId: p.id, branchId: t.branch.id, warehouseId: t.warehouse.id, quantity: "1" })) });
    assert.equal(await lowStockCount(t.org.id, t.branch.id), 230);
    const last = await listLowStock({ organizationId: t.org.id, branchId: t.branch.id, query: listQuery({ pageSize: 100, page: 3 }) });
    assert.deepEqual([last.rows.length, last.page.total, last.page.pageCount], [30, 230, 3]);
  });
});

test("the reorder list names the last vendor and price, the 30-day sales and a suggested quantity", async () => {
  await withTestOrg(async (t) => {
    const item = await product(t, "Seed", "10", { sellingPrice: "20.00", purchasePrice: "8.00" });
    const vendor = await factories(t).vendor({ name: "Green Seeds Ltd" });
    const bought = await postPurchase({ ...who(t), idempotencyKey: randomUUID(), supplierId: vendor.id, businessDate: today(), lines: [{ productId: item.id, quantity: "40", unitCost: "9.50" }] });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    const sold = await postSale({ ...who(t), idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId: item.id, quantity: "34" }], paymentAmount: "680.00", paymentMethod: "CASH" });
    assert.equal(sold.ok, true, JSON.stringify(sold)); // 6 left, reorder level 10, 34 sold in the last 30 days

    const [row] = await reorderList(t.org.id, t.branch.id);
    assert.deepEqual([row.name, row.onHand, row.reorderLevel, row.lastVendor, row.lastCost, row.sold30, row.suggested], ["Seed", "6.0000", "10.0000", "Green Seeds Ltd", "9.5000", "34.0000", "28"]);
    // enough for the next 30 days at the recent rate (34), or twice the reorder level (20), whichever is more: 34 - 6 on hand = 28
  });
});

test("lots near their expiry are warned about at 30, 60 and 90 days, and expired ones apart", async () => {
  await withTestOrg(async (t) => {
    const milk = await product(t, "Milk", "0", { trackExpiry: true });
    const lots = [
      ["EXPIRED", addDays(today(), -2), "1"],
      ["D20", addDays(today(), 20), "2"],
      ["D45", addDays(today(), 45), "3"],
      ["D80", addDays(today(), 80), "4"],
      ["D200", addDays(today(), 200), "5"],
    ] as const;
    for (const [lot, expiresOn, quantity] of lots) {
      assert.equal((await open(t, [{ productId: milk.id, quantity, unitCost: "1", lot, expiresOn }])).ok, true, lot);
    }
    const warn = await expiryWarnings(t.org.id, t.branch.id);
    assert.deepEqual(warn.buckets.map((b) => [b.label, b.lots, b.quantity]), [["Expired", 1, "1.0000"], ["Within 30 days", 1, "2.0000"], ["31-60 days", 1, "3.0000"], ["61-90 days", 1, "4.0000"]]);
    assert.deepEqual(warn.lots.map((l) => l.lot), ["EXPIRED", "D20", "D45", "D80"], "the lot 200 days away is not a warning");
    assert.deepEqual(warn.lots.map((l) => l.daysLeft), [-2, 20, 45, 80]);
  });
});
