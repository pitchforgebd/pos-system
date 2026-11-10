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
