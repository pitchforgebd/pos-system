import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { createAccount, postExpense } from "../accounting/books.ts";
import { createBankAccount } from "../accounting/books.ts";
import { postSale } from "../sales/sales.ts";
import { postSaleReturn } from "../sales/returns.ts";
import { stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { activeShiftOf, closeShift, countShift, getShift, handOverShift, openShift, postCashMovement } from "./shifts.ts";

// P08 task 6 (N7, B5, B6, I14, D17): every cash line is in a user's shift; what a drawer should hold is its opening cash plus what its own lines add
// up to; the count is compared; closing puts what is short or over in the books.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const who = (t: T, userId = t.owner.id) => ({ ...t.actor, userId, idempotencyKey: randomUUID() });

async function cashier(t: T, name: string) {
  return prisma.user.create({ data: { organizationId: t.org.id, name, email: `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`, passwordHash: "not-used", roles: { create: { organizationId: t.org.id, roleId: t.role.id } } } });
}
const roleAccount = async (t: T, role: string) => (await prisma.accountRole.findFirstOrThrow({ where: { organizationId: t.org.id, role: role as never }, select: { accountId: true } })).accountId;
const open = async (t: T, userId: string, openingCash = "100.00") => {
  const made = await openShift({ ...who(t, userId), openingCash });
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.ok ? made.id : "";
};
const sellCash = async (t: T, userId: string, productId: string, quantity: number, price = 10) => {
  const done = await postSale({ ...who(t, userId), businessDate: today(), lines: [{ productId, quantity: String(quantity) }], paymentAmount: (quantity * price).toFixed(2), paymentMethod: "CASH" });
  assert.equal(done.ok, true, JSON.stringify(done));
  return done.ok ? done.id : "";
};
const expected = async (t: T, id: string) => (await getShift(t.org.id, t.branch.id, id))?.expectedNow;

test("two cashiers on one branch: each drawer's expected cash is only their own (N7)", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 100, cost: "6.00", price: "10.00" });
    const [rina, karim] = [await cashier(t, "Rina"), await cashier(t, "Karim")];
    const [a, b] = [await open(t, rina.id, "100.00"), await open(t, karim.id, "50.00")];
    await sellCash(t, rina.id, product.id, 3);
    await sellCash(t, rina.id, product.id, 2);
    await sellCash(t, karim.id, product.id, 10);
    const spent = await postExpense({ ...who(t, rina.id), businessDate: today(), accountCode: "6100", amount: "20.00", method: "CASH", note: "Tea" });
    assert.equal(spent.ok, true, JSON.stringify(spent));
    assert.equal(await expected(t, a), "130.00", "100 + 30 + 20 - 20 for Rina");
    assert.equal(await expected(t, b), "150.00", "50 + 100 for Karim");
    const lines = await prisma.journalLine.findMany({ where: { organizationId: t.org.id, account: { kind: "CASH" } }, select: { shiftId: true } });
    assert.ok(lines.length > 0 && lines.every((l) => l.shiftId === a || l.shiftId === b), "every cash line is in one of the two shifts");
    assert.equal((await activeShiftOf(t.org.id, t.branch.id, rina.id))?.id, a);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("opening 10, cash in 5, cash out 2, a cash sale of 12 and its return: expected 13; counted 13 closes with no difference and no journal; closing twice is refused", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "6.00", price: "12.00" });
    const id = await open(t, t.owner.id, "10.00");
    assert.equal((await openShift({ ...who(t), openingCash: "1.00" })).ok, false, "one shift at a time");
    const capital = await roleAccount(t, "CAPITAL");
    const misc = await roleAccount(t, "MISC");
    assert.equal((await postCashMovement({ ...who(t), shiftId: id, direction: "IN", amount: "5.00", counterAccountId: capital, reason: "Float" })).ok, true);
    assert.equal((await postCashMovement({ ...who(t), shiftId: id, direction: "OUT", amount: "2.00", counterAccountId: misc, reason: "Stamps" })).ok, true);
    const sold = await sellCash(t, t.owner.id, product.id, 1, 12);
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sold } });
    const returned = await postSaleReturn({ ...who(t), saleId: sold, businessDate: today(), lines: [{ saleItemId: item.id, quantity: "1" }] });
    assert.equal(returned.ok, true, JSON.stringify(returned));
    assert.equal(await expected(t, id), "13.00");
    const counted = await countShift({ ...who(t), shiftId: id, actualCash: "13.00" });
    assert.deepEqual([counted.ok, counted.ok && !counted.replayed ? [counted.expectedCash, counted.difference] : null], [true, ["13.00", "0.00"]]);
    const stored = await prisma.shift.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([stored.status, stored.cashSales.toFixed(2), stored.refunds.toFixed(2), stored.cashIn.toFixed(2), stored.cashOut.toFixed(2)], ["CLOSING", "12.00", "12.00", "5.00", "2.00"]);
    const before = await prisma.journal.count({ where: { organizationId: t.org.id } });
    assert.equal((await closeShift({ ...who(t), shiftId: id })).ok, true);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), before, "no difference, no entry");
    const again = await closeShift({ ...who(t), shiftId: id });
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.message, "A closed shift cannot close again.");
    assert.equal((await postCashMovement({ ...who(t), shiftId: id, direction: "IN", amount: "1.00", counterAccountId: capital })).ok, false, "a closed shift takes no more cash");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("short and over (#39): closing puts the difference in the books and the drawer then holds what it should", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 100, cost: "6.00", price: "10.00" });
    const [rina, karim] = [await cashier(t, "Rina"), await cashier(t, "Karim")];
    const short = await open(t, rina.id, "100.00");
    const over = await open(t, karim.id, "100.00");
    await sellCash(t, rina.id, product.id, 5);
    await sellCash(t, karim.id, product.id, 5);
    assert.deepEqual(
      [
        (await countShift({ ...who(t, rina.id), shiftId: short, actualCash: "147.00" })).ok,
        (await countShift({ ...who(t, karim.id), shiftId: over, actualCash: "152.50" })).ok,
      ],
      [true, true],
    );
    assert.deepEqual([(await prisma.shift.findUniqueOrThrow({ where: { id: short } })).difference?.toFixed(2), (await prisma.shift.findUniqueOrThrow({ where: { id: over } })).difference?.toFixed(2)], ["-3.00", "2.50"]);
    const variance = async (id: string) => (await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "SHIFT_VARIANCE", docId: id } }, include: { account: { include: { roles: true } } } })).map((l) => `${l.account.roles[0]?.role ?? l.account.kind}:${l.debit.toFixed(2)}/${l.credit.toFixed(2)}`).sort();
    assert.equal((await closeShift({ ...who(t, rina.id), shiftId: short })).ok, true);
    assert.equal((await closeShift({ ...who(t, karim.id), shiftId: over })).ok, true);
    assert.deepEqual(await variance(short), ["CASH:0.00/3.00", "MISC:3.00/0.00"]);
    assert.deepEqual(await variance(over), ["CASH:2.50/0.00", "OTHER_INCOME:0.00/2.50"]);
    assert.equal(await expected(t, short), "147.00", "after closing the drawer holds what was counted");
    assert.equal(await expected(t, over), "152.50");
    assert.ok((await prisma.shift.findUniqueOrThrow({ where: { id: short } })).varianceJournalId);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("D17: a shop that requires shifts takes no cash without one; bank and credit sales need none", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 100, cost: "6.00", price: "10.00" });
    await prisma.organization.update({ where: { id: t.org.id }, data: { requireShift: true } });
    const bank = await createBankAccount({ ...who(t), name: "City Bank", kind: "BANK" });
    assert.equal(bank.ok, true);
    const bankId = (await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name: "City Bank" } })).id;
    const refused = await postSale({ ...who(t), businessDate: today(), lines: [{ productId: product.id, quantity: "1" }], paymentAmount: "10.00", paymentMethod: "CASH" });
    assert.equal(refused.ok, false);
    assert.equal(!refused.ok && refused.message, "Open a shift before taking or paying cash.");
    assert.equal(await prisma.sale.count({ where: { organizationId: t.org.id } }), 0, "nothing was sold");
    const spend = await postExpense({ ...who(t), businessDate: today(), accountCode: "6100", amount: "5.00", method: "CASH" });
    assert.equal(spend.ok, false, "an expense in cash needs a shift too");
    assert.equal((await postExpense({ ...who(t), businessDate: today(), accountCode: "6100", amount: "5.00", method: "BANK" })).ok, true, "by bank it needs none");
    void bankId;
    const id = await open(t, t.owner.id);
    const ok = await postSale({ ...who(t), businessDate: today(), lines: [{ productId: product.id, quantity: "1" }], paymentAmount: "10.00", paymentMethod: "CASH" });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(await expected(t, id), "110.00");
    await prisma.organization.update({ where: { id: t.org.id }, data: { requireShift: false } });
    assert.equal((await countShift({ ...who(t), shiftId: id, actualCash: "110.00" })).ok, true);
    assert.equal((await closeShift({ ...who(t), shiftId: id })).ok, true);
    const without = await postSale({ ...who(t), businessDate: today(), lines: [{ productId: product.id, quantity: "1" }], paymentAmount: "10.00", paymentMethod: "CASH" });
    assert.equal(without.ok, true, "with the rule off, a sale needs no shift (its cash line is in no shift)");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the count by notes and coins; a count in whole denominations only; the handover into the main cash is a contra that empties the drawer", async () => {
  await withTestOrg(async (t) => {
    const made = await createAccount({ organizationId: t.org.id, code: "1150", name: "Main cash box", groupCode: "1000" });
    assert.equal(made.ok, true, JSON.stringify(made));
    const main = await prisma.account.update({ where: { organizationId_code: { organizationId: t.org.id, code: "1150" } }, data: { kind: "CASH" } });
    const product = await stockedProduct(t, { units: 100, cost: "6.00", price: "10.00" });
    const manager = await cashier(t, "Manager");
    const id = await open(t, t.owner.id, "1000.00");
    await sellCash(t, t.owner.id, product.id, 65);
    assert.equal(await expected(t, id), "1650.00");
    assert.equal((await countShift({ ...who(t), shiftId: id, denominations: { "1000": 1, "7": 2 } })).ok, false, "7 is not a note");
    const counted = await countShift({ ...who(t), shiftId: id, denominations: { "1000": 1, "500": 1, "100": 1, "50": 1 } });
    assert.deepEqual([counted.ok, counted.ok && !counted.replayed ? counted.difference : null], [true, "0.00"]);
    assert.deepEqual((await prisma.shift.findUniqueOrThrow({ where: { id } })).denominations, { "1000": 1, "500": 1, "100": 1, "50": 1 });
    {
      const handed = await handOverShift({ ...who(t), shiftId: id, toUserId: manager.id, amount: "1650.00", toAccountId: main.id });
      assert.equal(handed.ok, true, JSON.stringify(handed));
      const lines = await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "CONTRA" } }, include: { account: true } });
      assert.deepEqual(lines.map((l) => `${l.account.name}:${l.debit.toFixed(2)}/${l.credit.toFixed(2)}`).sort(), ["Cash in Hand:0.00/1650.00", "Main cash box:1650.00/0.00"]);
      assert.equal(await expected(t, id), "0.00", "the drawer is empty after the handover");
    }
    assert.equal((await handOverShift({ ...who(t), shiftId: id, toUserId: t.owner.id, amount: "1.00" })).ok, false, "not to yourself");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the same open twice is one shift; only the shift's own cashier moves cash through it", async () => {
  await withTestOrg(async (t) => {
    const key = randomUUID();
    const one = await openShift({ ...t.actor, idempotencyKey: key, openingCash: "20.00" });
    const two = await openShift({ ...t.actor, idempotencyKey: key, openingCash: "20.00" });
    assert.deepEqual([one.ok, two.ok, two.ok && two.replayed], [true, true, true]);
    assert.equal(await prisma.shift.count({ where: { organizationId: t.org.id } }), 1);
    const other = await cashier(t, "Other");
    const capital = await roleAccount(t, "CAPITAL");
    const sneaky = await postCashMovement({ ...who(t, other.id), shiftId: one.ok ? one.id : "", direction: "IN", amount: "1.00", counterAccountId: capital });
    assert.equal(sneaky.ok, false);
  });
});
