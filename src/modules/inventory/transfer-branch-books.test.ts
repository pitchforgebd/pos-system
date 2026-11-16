import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { businessDate } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { withTestOrg, factories } from "../../tests/helpers/index.ts";
import { postOpeningStock, postTransfer } from "./documents.ts";

// Found by the 7-day user test: after stock went from one branch to another, the sending branch's trial balance and balance sheet did not
// agree (the journal had Inventory in one branch against Inventory in the other). Each side now goes through the inter-branch clearing
// account, so every branch's books balance on their own and the clearing account nets to zero for the company.
test("a transfer between branches keeps each branch's books balanced; the clearing account nets to zero", async () => {
  await withTestOrg(async (t) => {
    const depot = await prisma.branch.create({ data: { organizationId: t.org.id, name: "Depot" } });
    const store = await prisma.warehouse.create({ data: { organizationId: t.org.id, branchId: depot.id, name: "Depot store" } });
    const product = await factories(t).product();
    const today = businessDate();
    assert.equal((await postOpeningStock({ ...t.actor, idempotencyKey: randomUUID(), businessDate: today, lines: [{ productId: product.id, quantity: "10", unitCost: "110.50" }] })).ok, true);
    const moved = await postTransfer({ organizationId: t.org.id, userId: t.owner.id, fromBranchId: t.branch.id, toBranchId: depot.id, fromWarehouseId: t.warehouse.id, toWarehouseId: store.id, ip: "127.0.0.1", userAgent: "test", idempotencyKey: randomUUID(), lines: [{ productId: product.id, quantity: "4" }] });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    const rows = await prisma.$queryRaw<Array<{ branchId: string; code: string; net: string }>>`
      SELECT l.branchId AS branchId, a.code AS code, SUM(l.debit - l.credit) AS net FROM journal_lines l JOIN accounts a ON a.id = l.accountId
      WHERE l.organizationId = ${t.org.id} GROUP BY l.branchId, a.code`;
    const branchSum = (branchId: string) => rows.filter((r) => r.branchId === branchId).reduce((s, r) => s + Number(r.net), 0);
    assert.equal(branchSum(t.branch.id), 0, "the sending branch balances");
    assert.equal(branchSum(depot.id), 0, "the receiving branch balances");
    const net = (branchId: string, code: string) => Number(rows.find((r) => r.branchId === branchId && r.code === code)?.net ?? 0);
    assert.equal(net(depot.id, "1400"), 442, "the depot holds 4 x 110.50 of stock");
    assert.equal(net(t.branch.id, "1400"), 663, "the shop keeps 6 x 110.50");
    assert.equal(net(t.branch.id, "1480") + net(depot.id, "1480"), 0, "the clearing account nets to zero across the company");
    assert.equal(net(depot.id, "1480"), -442);
  });
});
