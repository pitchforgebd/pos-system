import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { addDays, businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { createBankAccount, postContra } from "../accounting/books.ts";
import { postInvoice } from "../sales/invoice.ts";
import { factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { chargeOf, listChargeRules, saveChargeRule, suggestCharge } from "./charges.ts";
import { postContraTransfer } from "./contra.ts";
import { accrueMonth, expenseReport, generateDrafts, listCategories, listExpenseRows, payDraft, payExpense, saveRecurring, settleAccrued } from "./expenses.ts";

// P08 tasks 2-4 (#30, #31, D7): the charge a bank or a mobile account takes is proposed from its rule and is an expense line; a recurring expense is a
// draft each month, paid or booked as owed; money moves between the shop's own accounts with the sender's charge.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T, key = randomUUID()) => ({ ...t.actor, idempotencyKey: key });
const who = (t: T) => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, ip: "127.0.0.1", userAgent: "test" });
const roleAccount = async (t: T, role: string) => (await prisma.accountRole.findFirstOrThrow({ where: { organizationId: t.org.id, role: role as never }, select: { accountId: true } })).accountId;

async function money(t: T, input: { kind: "MOBILE" | "BANK"; name: string; opening?: string }) {
  const made = await createBankAccount({ ...actor(t), name: input.name, kind: input.kind, accountNumber: "01711-000000", openingAmount: input.opening });
  assert.equal(made.ok, true, JSON.stringify(made));
  return prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name: input.name } });
}

/** What an account holds: its posted debits less its credits. */
async function balance(t: T, accountId: string) {
  const sum = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, accountId, journal: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return (Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0)).toFixed(2);
}

const lines = async (t: T, docType: string) =>
  (await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType } }, include: { account: { include: { roles: true } } } }))
    .map((l) => `${l.account.roles[0]?.role ?? l.account.code}:${l.debit.toFixed(2)}/${l.credit.toFixed(2)}`)
    .sort();

const earlierMonth = () => addDays(today(), -35).slice(0, 7);

test("bKash 1.85%: 1000 proposes 18.50; a receipt through it puts 18.50 on 6610 and still settles the whole 1000 on the receivable", async () => {
  await withTestOrg(async (t) => {
    const bkash = await money(t, { kind: "MOBILE", name: "bKash" });
    assert.equal((await suggestCharge(t.org.id, bkash.id, "1000.00")).charge, "0.00", "no rule yet, no charge");
    const saved = await saveChargeRule(who(t), { accountId: bkash.id, percent: "1.85", fixed: "0", bearer: "SHOP" });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const suggestion = await suggestCharge(t.org.id, bkash.id, "1000.00");
    assert.deepEqual([suggestion.charge, suggestion.customerPays, suggestion.bearer, suggestion.kind], ["18.50", "0.00", "SHOP", "MOBILE"]);

    const product = await stockedProduct(t, { units: 100, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const sold = await postInvoice({ ...actor(t), businessDate: today(), customerId: customer.id, lines: [{ productId: product.id, quantity: "100" }], tenders: [{ method: "MOBILE", accountId: bkash.id, amount: "1000.00", charge: suggestion.charge }] });
    assert.equal(sold.ok, true, JSON.stringify(sold));
    assert.deepEqual(await lines(t, "CUSTOMER_PAYMENT"), ["AR:0.00/1000.00", "MOBILE_CHARGE:18.50/0.00", `${bkash.code}:981.50/0.00`].sort());
    assert.equal(await balance(t, bkash.id), "981.50");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });

    // the customer bears it: the shop's charge is nothing and the form says how much more the customer sends
    assert.equal((await saveChargeRule(who(t), { accountId: bkash.id, percent: "1.85", fixed: "0", bearer: "CUSTOMER" })).ok, true);
    const theirs = await suggestCharge(t.org.id, bkash.id, "1000.00");
    assert.deepEqual([theirs.charge, theirs.customerPays, theirs.bearer], ["0.00", "18.50", "CUSTOMER"]);
  });
});

test("a charge rule has a percentage and a fixed part; a cash account has none; only a bank or mobile account can have one; the rules list shows them", async () => {
  await withTestOrg(async (t) => {
    const bank = await money(t, { kind: "BANK", name: "City Bank" });
    assert.equal((await saveChargeRule(who(t), { accountId: bank.id, percent: "0.5", fixed: "10", bearer: "SHOP" })).ok, true);
    assert.equal((await suggestCharge(t.org.id, bank.id, "2000.00")).charge, "20.00", "0.5% of 2000 is 10, and 10 fixed");
    assert.equal((await suggestCharge(t.org.id, await roleAccount(t, "CASH"), "2000.00")).charge, "0.00");
    assert.equal((await saveChargeRule(who(t), { accountId: await roleAccount(t, "CASH"), percent: "1", fixed: "0", bearer: "SHOP" })).ok, false);
    assert.equal((await saveChargeRule(who(t), { accountId: bank.id, percent: "101", fixed: "0", bearer: "SHOP" })).ok, false);
    assert.equal(chargeOf({ percent: new Prisma.Decimal("0.5"), fixed: new Prisma.Decimal("10") }, new Prisma.Decimal("2000")).toFixed(2), "20.00");
    const rules = await listChargeRules(t.org.id);
    assert.deepEqual(rules.filter((rule) => rule.accountId === bank.id).map((rule) => [rule.percent, rule.fixed, rule.bearer]), [["0.50", "10.00", "SHOP"]]);
  });
});

test("recurring rent: a draft each month (made once), paid later from cash, belongs to its own month in the report", async () => {
  await withTestOrg(async (t) => {
    const month = earlierMonth();
    const rent = (await listCategories(t.org.id)).find((category) => category.name === "Rent");
    assert.ok(rent, "the usual categories are there");
    assert.equal(rent.accountCode, "6100");
    assert.equal((await saveRecurring(who(t), { categoryId: rent.id, amount: "5000.00", dayOfMonth: 5 })).ok, true);

    assert.deepEqual(await generateDrafts(who(t), month), { created: 1 });
    assert.deepEqual(await generateDrafts(who(t), month), { created: 0 }, "a month has one draft for each recurring expense");
    const [draft] = await listExpenseRows(t.org.id, t.branch.id, { periodMonth: month, status: "DRAFT" });
    assert.deepEqual([draft.status, draft.amount, draft.periodMonth, draft.businessDate, draft.recurring, draft.number], ["DRAFT", "5000.00", month, `${month}-05`, true, null]);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id, docType: "EXPENSE" } }), 0, "a draft is not in the books");

    const cash = await roleAccount(t, "CASH");
    const paid = await payDraft({ ...actor(t), expenseId: draft.id, businessDate: today(), moneyAccountId: cash, amount: "5000.00" });
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.match(paid.ok ? (paid.number ?? "") : "", /^EXP-/);
    assert.deepEqual(await lines(t, "EXPENSE"), ["6100:5000.00/0.00", "CASH:0.00/5000.00"]);
    const stored = await prisma.expense.findUniqueOrThrow({ where: { id: draft.id } });
    assert.deepEqual([stored.status, stored.periodMonth, stored.moneyAccountId], ["PAID", month, cash]);
    assert.equal((await payDraft({ ...actor(t), expenseId: draft.id, businessDate: today(), moneyAccountId: cash, amount: "5000.00" })).ok, false, "paid once");

    const report = await expenseReport(t.org.id, t.branch.id, month, month);
    assert.deepEqual(report.rows, [{ month, category: "Rent", booked: "5000.00", owed: "0.00", draft: "0.00", charge: "0.00" }]);
    assert.deepEqual((await expenseReport(t.org.id, t.branch.id, today().slice(0, 7), today().slice(0, 7))).rows.filter((row) => row.month !== month), [], "paid this month, but it is last month's rent");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("month end: what is unpaid is booked as owed (Dr expense / Cr Accrued Expenses), once; paying it later clears the accrual and may carry a bank charge", async () => {
  await withTestOrg(async (t) => {
    const month = earlierMonth();
    const categories = await listCategories(t.org.id);
    const rent = categories.find((category) => category.name === "Rent");
    const internet = categories.find((category) => category.name === "Internet");
    assert.ok(rent && internet);
    await saveRecurring(who(t), { categoryId: rent.id, amount: "5000.00", dayOfMonth: 1 });
    await saveRecurring(who(t), { categoryId: internet.id, amount: "1000.00", dayOfMonth: 10 });
    await generateDrafts(who(t), month);

    const accrued = await accrueMonth({ ...actor(t), periodMonth: month });
    assert.deepEqual([accrued.ok, accrued.ok ? accrued.count : null, accrued.ok ? accrued.total : null], [true, 2, "6000.00"]);
    assert.deepEqual(await lines(t, "EXPENSE"), ["6100:5000.00/0.00", "6300:1000.00/0.00", "ACCRUED:0.00/1000.00", "ACCRUED:0.00/5000.00"].sort());
    const again = await accrueMonth({ ...actor(t), periodMonth: month });
    assert.deepEqual([again.ok, again.ok ? again.count : null], [true, 0], "booked once");
    const owed = await prisma.expense.findMany({ where: { organizationId: t.org.id, status: "ACCRUED" }, orderBy: { amount: "desc" } });
    assert.equal(owed.length, 2);
    assert.ok(owed.every((row) => row.periodMonth === month && row.journalId));
    const accruedAccount = await roleAccount(t, "ACCRUED");
    assert.equal(await balance(t, accruedAccount), "-6000.00");

    const bank = await money(t, { kind: "BANK", name: "City Bank", opening: "20000.00" });
    const settled = await settleAccrued({ ...actor(t), expenseId: owed[0].id, businessDate: today(), moneyAccountId: bank.id, charge: "15.00" });
    assert.equal(settled.ok, true, JSON.stringify(settled));
    assert.deepEqual(await lines(t, "EXPENSE_SETTLEMENT"), ["ACCRUED:5000.00/0.00", `${bank.code}:0.00/5015.00`, "BANK_CHARGE:15.00/0.00"].sort());
    assert.equal(await balance(t, accruedAccount), "-1000.00");
    assert.equal(await balance(t, bank.id), "14985.00");
    assert.equal((await settleAccrued({ ...actor(t), expenseId: owed[0].id, businessDate: today(), moneyAccountId: bank.id })).ok, false, "settled once");

    const report = await expenseReport(t.org.id, t.branch.id, month, month);
    assert.deepEqual(report.totals, { booked: "6000.00", owed: "1000.00", draft: "0.00", charge: "15.00" });
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("an expense paid by bKash with its charge: the expense, the 6610 line and the wallet add up; a cash payment cannot carry a charge", async () => {
  await withTestOrg(async (t) => {
    const bkash = await money(t, { kind: "MOBILE", name: "bKash", opening: "3000.00" });
    const transport = (await listCategories(t.org.id)).find((category) => category.name === "Transport");
    assert.ok(transport);
    const paid = await payExpense({ ...actor(t), businessDate: today(), categoryId: transport.id, amount: "1000.00", moneyAccountId: bkash.id, charge: "18.50", note: "Courier drop" });
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.deepEqual(await lines(t, "EXPENSE"), ["MOBILE_CHARGE:18.50/0.00", "TRANSPORT:1000.00/0.00", `${bkash.code}:0.00/1018.50`].sort());
    assert.equal(await balance(t, bkash.id), "1981.50");
    const stored = await prisma.expense.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.deepEqual([stored.status, stored.periodMonth, stored.charge.toFixed(2)], ["PAID", today().slice(0, 7), "18.50"]);
    const cash = await roleAccount(t, "CASH");
    assert.equal((await payExpense({ ...actor(t), businessDate: today(), categoryId: transport.id, amount: "10.00", moneyAccountId: cash, charge: "1.00" })).ok, false);
    assert.equal((await payExpense({ ...actor(t), businessDate: today(), categoryId: transport.id, amount: "0", moneyAccountId: cash })).ok, false);
    const key = randomUUID();
    const first = await payExpense({ ...actor(t, key), businessDate: today(), categoryId: transport.id, amount: "10.00", moneyAccountId: cash });
    const replayed = await payExpense({ ...actor(t, key), businessDate: today(), categoryId: transport.id, amount: "10.00", moneyAccountId: cash });
    assert.deepEqual([first.ok, replayed.ok, first.ok && replayed.ok ? first.id === replayed.id : null], [true, true, true], "the same key is the same expense");
    assert.equal(await prisma.expense.count({ where: { organizationId: t.org.id } }), 2);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a contra transfer between any two accounts: the sender loses the amount and its charge, the other gains the amount; the old cash-to-bank button still works", async () => {
  await withTestOrg(async (t) => {
    const bkash = await money(t, { kind: "MOBILE", name: "bKash", opening: "5000.00" });
    const bank = await money(t, { kind: "BANK", name: "City Bank" });
    const moved = await postContraTransfer({ ...actor(t), businessDate: today(), fromAccountId: bkash.id, toAccountId: bank.id, amount: "3000.00", charge: "55.50" });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    assert.match(moved.ok ? (moved.number ?? "") : "", /^CTR-/);
    assert.deepEqual(await lines(t, "CONTRA"), [`${bank.code}:3000.00/0.00`, "MOBILE_CHARGE:55.50/0.00", `${bkash.code}:0.00/3055.50`].sort());
    assert.deepEqual([await balance(t, bkash.id), await balance(t, bank.id)], ["1944.50", "3000.00"]);
    const row = await prisma.contraTransfer.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.deepEqual([row.amount.toFixed(2), row.charge.toFixed(2), row.fromAccountId, row.toAccountId], ["3000.00", "55.50", bkash.id, bank.id]);

    const cash = await roleAccount(t, "CASH");
    assert.equal((await postContraTransfer({ ...actor(t), businessDate: today(), fromAccountId: cash, toAccountId: bank.id, amount: "10.00", charge: "1.00" })).ok, false, "cash has no charge");
    assert.equal((await postContraTransfer({ ...actor(t), businessDate: today(), fromAccountId: bank.id, toAccountId: bank.id, amount: "10.00" })).ok, false, "two different accounts");
    const old = await postContra({ ...actor(t), businessDate: today(), direction: "BANK_TO_CASH", amount: "100.00" });
    assert.equal(old.ok, true, JSON.stringify(old));
    assert.equal(await prisma.contraTransfer.count({ where: { organizationId: t.org.id } }), 2);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
