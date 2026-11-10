import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { postOpeningStock, postTakeOff } from "./documents.ts";
import { listStock, stockSummary } from "./stock.ts";

// P03 task 6: what stock is worth comes from the moving-average cost the books carry, never from the product's list purchase price.

test("the stock list and summary value the stock at the average cost, and the books show the same number", async () => {
  await withTestOrg(async (t) => {
    const who = { organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, warehouseId: t.warehouse.id, ip: "127.0.0.1", userAgent: "test" };
    const product = await factories(t).product({ purchasePrice: "10.00", sellingPrice: "15.00" }); // the list price is 10.00
    assert.equal((await postOpeningStock({ ...who, idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId: product.id, quantity: "10", unitCost: "6.5000" }] })).ok, true);
    assert.equal((await postTakeOff({ ...who, idempotencyKey: randomUUID(), businessDate: today(), purpose: "SAMPLE", recipient: "r", approvedBy: "a", lines: [{ productId: product.id, quantity: "4" }] } as Parameters<typeof postTakeOff>[0])).ok, true);

    const [row] = await listStock({ organizationId: t.org.id, branchId: t.branch.id });
    assert.deepEqual([row.quantity, row.averageCost, row.stockValue, row.saleValue], ["6.0000", "6.5000", "39.00", "90.00"]);
    const summary = await stockSummary(t.org.id, t.branch.id);
    assert.equal(summary.stockValue, "39.00", "6 left x 6.50, not 6 x the list price 10.00");

    const sums = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, account: { roles: { some: { role: "INVENTORY" } } } }, _sum: { debit: true, credit: true } });
    assert.equal((Number(sums._sum.debit) - Number(sums._sum.credit)).toFixed(2), summary.stockValue, "the inventory account is what the stock summary says");
  });
});

test("ledgerMatchesBalance is one aggregate: true when the stock equals its movements, false when it does not, in either direction", async () => {
  await withTestOrg(async (t) => {
    const { ledgerMatchesBalance } = await import("./stock.ts");
    const who = { organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, warehouseId: t.warehouse.id, ip: "127.0.0.1", userAgent: "test" };
    const product = await factories(t).product();
    assert.equal(await ledgerMatchesBalance(t.org.id, t.branch.id), true, "nothing at all matches");
    assert.equal((await postOpeningStock({ ...who, idempotencyKey: randomUUID(), businessDate: today(), lines: [{ productId: product.id, quantity: "5", unitCost: "2" }] })).ok, true);
    assert.equal(await ledgerMatchesBalance(t.org.id, t.branch.id), true);
    await prisma.stockBalance.updateMany({ where: { organizationId: t.org.id, productId: product.id }, data: { quantity: "6" } });
    assert.equal(await ledgerMatchesBalance(t.org.id, t.branch.id), false, "stock above its movements");
    await prisma.stockBalance.updateMany({ where: { organizationId: t.org.id, productId: product.id }, data: { quantity: "5" } });
    await prisma.stockBalance.deleteMany({ where: { organizationId: t.org.id, productId: product.id } });
    assert.equal(await ledgerMatchesBalance(t.org.id, t.branch.id), false, "movements with no stock row");
  });
});

test("an expiry-tracked product always has batches: the batch flag follows trackExpiry", async () => {
  await withTestOrg(async (t) => {
    const { createProduct } = await import("../catalog/products.ts");
    const made = await createProduct({
      organizationId: t.org.id, actorId: t.owner.id, name: "Milk", sku: "MILK-1", purchasePrice: "1.00", sellingPrice: "2.00", wholesalePrice: "2.00", minimumPrice: "1.00",
      trackStock: true, trackExpiry: true, trackSerial: false, reorderLevel: "0", warrantyAvailable: false, ip: "127.0.0.1", userAgent: "test",
    } as Parameters<typeof createProduct>[0]);
    assert.equal(made.ok, true, JSON.stringify(made));
    const row = await prisma.product.findFirstOrThrow({ where: { organizationId: t.org.id, sku: "MILK-1" } });
    assert.deepEqual([row.trackExpiry, row.trackBatch], [true, true]);
  });
});
