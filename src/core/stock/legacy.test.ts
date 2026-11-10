import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { reconcileBooks } from "../reconcile/index.ts";
import { runTx } from "../tx/run.ts";
import { adjustLegacyStockBooks } from "./legacy.ts";

// P03 task 12: a database that held stock before stock had a journal (the old documents wrote no journal) has stock the books do
// not carry. One visible "v2 opening adjustment" journal per branch brings the inventory account to stock x average cost; stock that
// never had a cost is given its purchase price as the average (the books must carry some value, and that is the best known one).

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];

/** Stock the way the old code left it: a balance and a ledger row, no journal. */
async function oldStock(t: T, quantity: string, averageCost: string | null, purchasePrice = "10.00") {
  const key = Math.random().toString(36).slice(2, 10);
  const product = await factories(t).product({ purchasePrice, sku: `OLD-${key}`, slug: `old-${key}` });
  await prisma.stockBalance.create({ data: { organizationId: t.org.id, productId: product.id, branchId: t.branch.id, warehouseId: t.warehouse.id, quantity, averageCost } });
  await prisma.stockLedger.create({
    data: { organizationId: t.org.id, productId: product.id, branchId: t.branch.id, warehouseId: t.warehouse.id, quantity, direction: "IN", movementType: "OPENING", referenceType: "opening_stock", referenceId: product.id, unitCost: averageCost, userId: t.owner.id },
  });
  return product;
}

const inventory = async (t: T) => {
  const sums = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, account: { roles: { some: { role: "INVENTORY" } } } }, _sum: { debit: true, credit: true } });
  return (Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0)).toFixed(2);
};

test("stock the books never carried gets one visible adjustment journal, and the inventory account then equals the stock value", async () => {
  await withTestOrg(async (t) => {
    await oldStock(t, "10", "6.0000");
    await oldStock(t, "4", "2.5000");
    assert.deepEqual((await reconcileBooks(prisma, t.org.id)).warnings.map((w) => w.invariant), ["I6"], "the inventory account is 0.00 against 70.00 of stock");

    const done = await runTx((tx) => adjustLegacyStockBooks(tx, { organizationId: t.org.id, userId: t.owner.id }));
    assert.deepEqual([done.branches, done.priced], [1, 0]);
    assert.equal(await inventory(t), "70.00");
    const journal = await prisma.journal.findFirstOrThrow({ where: { organizationId: t.org.id, docType: "STOCK_BOOKS_ADJUSTMENT" }, include: { lines: { include: { account: { include: { roles: true } } } } } });
    assert.deepEqual(journal.lines.map((l) => [l.account.roles[0]?.role, Number(l.debit), Number(l.credit)]).sort(), [["INVENTORY", 70, 0], ["OPENING_EQUITY", 0, 70]]);
    assert.deepEqual((await reconcileBooks(prisma, t.org.id)).warnings, []);
  });
});

test("it is safe to run again: nothing is left to adjust, and a later difference is adjusted by the difference only", async () => {
  await withTestOrg(async (t) => {
    await oldStock(t, "10", "6.0000");
    await runTx((tx) => adjustLegacyStockBooks(tx, { organizationId: t.org.id, userId: t.owner.id }));
    const again = await runTx((tx) => adjustLegacyStockBooks(tx, { organizationId: t.org.id, userId: t.owner.id }));
    assert.equal(again.branches, 0);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id, docType: "STOCK_BOOKS_ADJUSTMENT" } }), 1);
    // more old stock appears later (another old document)
    await oldStock(t, "5", "4.0000");
    const third = await runTx((tx) => adjustLegacyStockBooks(tx, { organizationId: t.org.id, userId: t.owner.id }));
    assert.equal(third.branches, 1);
    assert.equal(await inventory(t), "80.00");
  });
});

test("stock that never had a cost is valued at the product's purchase price, which becomes its average", async () => {
  await withTestOrg(async (t) => {
    const product = await oldStock(t, "3", null, "12.00");
    const done = await runTx((tx) => adjustLegacyStockBooks(tx, { organizationId: t.org.id, userId: t.owner.id }));
    assert.equal(done.priced, 1);
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: t.org.id, productId: product.id } })).averageCost?.toFixed(4), "12.0000");
    assert.equal(await inventory(t), "36.00");
  });
});

test("an inventory account that holds more than the stock is brought down the other way", async () => {
  await withTestOrg(async (t) => {
    await oldStock(t, "2", "5.0000");
    await runTx((tx) => adjustLegacyStockBooks(tx, { organizationId: t.org.id, userId: t.owner.id }));
    await prisma.stockBalance.updateMany({ where: { organizationId: t.org.id }, data: { quantity: "1" } });
    await prisma.stockLedger.create({ data: { organizationId: t.org.id, productId: (await prisma.product.findFirstOrThrow({ where: { organizationId: t.org.id } })).id, branchId: t.branch.id, warehouseId: t.warehouse.id, quantity: "1", direction: "OUT", movementType: "ADJUSTMENT", referenceType: "old", referenceId: t.org.id, unitCost: "5.0000", userId: t.owner.id } });
    const done = await runTx((tx) => adjustLegacyStockBooks(tx, { organizationId: t.org.id, userId: t.owner.id }));
    assert.equal(done.branches, 1);
    assert.equal(await inventory(t), "5.00");
  });
});
