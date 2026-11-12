import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { hashPassword } from "../auth/password.ts";
import { stockedProduct, TEST_PASSWORD, withTestOrg } from "../../tests/helpers/index.ts";
import { postReceiptlessReturn, type ReceiptlessInput } from "./receiptless.ts";

// P06 task 8 (N10): a return with no invoice needs the permission and a second user's approval, refunds at most the current retail price,
// splits the VAT, takes the stock back at what it costs now, and refunds from the till.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];

async function manager(t: T, withPermission = true) {
  const role = withPermission ? t.role : await prisma.role.create({ data: { organizationId: t.org.id, name: "Clerk" } });
  const email = `manager-${randomUUID().slice(0, 8)}@example.test`;
  await prisma.user.create({ data: { organizationId: t.org.id, name: "Manager", email, passwordHash: await hashPassword(TEST_PASSWORD), roles: { create: { organizationId: t.org.id, roleId: role.id } } } });
  return email;
}

const give = (t: T, input: Partial<ReceiptlessInput> & Pick<ReceiptlessInput, "lines" | "approver">) =>
  postReceiptlessReturn({ ...t.actor, idempotencyKey: randomUUID(), businessDate: today(), reason: "No receipt, the customer says it was bought here", refundMethod: "CASH", ...input });

test("a return with no invoice: approved by a second user, refunded from the till at the current price, VAT split out, stock back at today's cost", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "60.00", price: "100.00", product: { vatType: "EXCLUSIVE", vatValue: "10" } });
    const email = await manager(t);
    const done = await give(t, { approver: { email, password: TEST_PASSWORD }, lines: [{ productId: product.id, quantity: "1" }] });
    assert.equal(done.ok, true, JSON.stringify(done));
    if (!done.ok) {
      return;
    }
    assert.equal(done.total, "110.00", "100.00 and 10% VAT");
    const lines = (await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "SALE_RETURN", docId: done.id } }, include: { account: { include: { roles: true } } } }))
      .map((l) => `${l.account.roles[0]?.role}:${l.debit.toFixed(2)}/${l.credit.toFixed(2)}`)
      .sort();
    assert.deepEqual(lines, ["CASH:0.00/110.00", "COGS:0.00/60.00", "INVENTORY:60.00/0.00", "OUTPUT_VAT:10.00/0.00", "SALES:100.00/0.00"]);
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { productId: product.id } })).quantity.toFixed(4), "11.0000");
    const row = await prisma.receiptlessReturn.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.notEqual(row.approvedById, row.createdById, "approved by somebody else");
    assert.ok(/^RET-/.test(row.number ?? ""));
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("never more than the current retail price; a reason is needed; an inclusive price has its VAT in it", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "60.00", price: "100.00", product: { vatType: "INCLUSIVE", vatValue: "15" } });
    const email = await manager(t);
    const approver = { email, password: TEST_PASSWORD };
    const over = await give(t, { approver, lines: [{ productId: product.id, quantity: "1", unitRefund: "100.01" }] });
    assert.equal(over.ok, false);
    assert.match(!over.ok ? over.message : "", /retail price/i);
    const noReason = await give(t, { approver, reason: " ", lines: [{ productId: product.id, quantity: "1" }] });
    assert.equal(noReason.ok, false);
    const less = await give(t, { approver, lines: [{ productId: product.id, quantity: "2", unitRefund: "80.00" }] });
    assert.equal(less.ok, true, JSON.stringify(less));
    // 2 x 80.00 = 160.00 with 15% VAT inside: 160 - 160/1.15 = 20.87
    const row = await prisma.receiptlessReturn.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.deepEqual([row.total.toFixed(2), row.vatTotal.toFixed(2)], ["160.00", "20.87"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the approval: not yourself, not a wrong password, not a user without the permission; nothing is posted when it is refused", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "60.00", price: "100.00" });
    const good = await manager(t);
    const clerk = await manager(t, false);
    const lines = [{ productId: product.id, quantity: "1" }];
    const refusals = [
      await give(t, { approver: { email: t.owner.email, password: TEST_PASSWORD }, lines }),
      await give(t, { approver: { email: good, password: "not-the-password" }, lines }),
      await give(t, { approver: { email: clerk, password: TEST_PASSWORD }, lines }),
      await give(t, { approver: { email: "nobody@example.test", password: TEST_PASSWORD }, lines }),
    ];
    assert.deepEqual(refusals.map((r) => r.ok), [false, false, false, false]);
    assert.ok(refusals.every((r) => !r.ok && r.message === "The approval is not valid."), "the same answer for every reason");
    assert.equal(await prisma.receiptlessReturn.count({ where: { organizationId: t.org.id } }), 0);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id, docType: "SALE_RETURN" } }), 0);
    const ok = await give(t, { approver: { email: good, password: TEST_PASSWORD }, lines });
    assert.equal(ok.ok, true, JSON.stringify(ok));
  });
});

test("the same request twice is one return", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "60.00", price: "100.00" });
    const email = await manager(t);
    const key = randomUUID();
    const input = { idempotencyKey: key, approver: { email, password: TEST_PASSWORD }, lines: [{ productId: product.id, quantity: "1" }] };
    const first = await give(t, input);
    const again = await give(t, input);
    assert.deepEqual([first.ok, again.ok, again.ok && again.replayed], [true, true, true]);
    assert.equal(await prisma.receiptlessReturn.count({ where: { organizationId: t.org.id } }), 1);
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { productId: product.id } })).quantity.toFixed(4), "11.0000");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
