import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { prisma } from "../../lib/db/client.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { balanceSheet, trialBalanceReport } from "../reports/more.ts";
import { profitReport } from "../reports/daily-trade.ts";
import { postCapital, postExpense, postIncome } from "./books.ts";
import { closeYear, listYears } from "./year-end.ts";

// P11 task 8: closing a fiscal year brings every income and expense account of the year to zero in one journal dated its last day, the profit goes to
// Retained Earnings, and the period is locked. Reports still show the closed year's profit; the books reconcile.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T) => ({ ...t.actor, idempotencyKey: randomUUID() });
const role = async (t: T, name: string) => (await prisma.accountRole.findFirstOrThrow({ where: { organizationId: t.org.id, role: name as never }, include: { account: true } })).account;
const balance = async (t: T, accountId: string) => {
  const sum = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, accountId, journal: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return (Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0)).toFixed(2);
};

async function aYear(t: T) {
  const income = (await role(t, "OTHER_INCOME")).code;
  const rent = (await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name: "Rent" } })).code;
  for (const result of [
    await postCapital({ ...actor(t), businessDate: "2025-07-02", capitalType: "ADDED", ownerName: "Owner", amount: "10000.00", method: "CASH" }),
    await postIncome({ ...actor(t), businessDate: "2025-09-10", accountCode: income, amount: "900.00", method: "CASH" }),
    await postIncome({ ...actor(t), businessDate: "2026-03-15", accountCode: income, amount: "600.00", method: "CASH" }),
    await postExpense({ ...actor(t), businessDate: "2025-12-01", accountCode: rent, amount: "400.00", method: "CASH" }),
  ]) {
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  return { income, rent };
}

test("closing 2025-26: one journal on 30 June zeroes the year's income and expense, 1,100 profit goes to Retained Earnings, the period is locked; reports still show the profit", async () => {
  await withTestOrg(async (t) => {
    const { income, rent } = await aYear(t);
    const years = await listYears(t.org.id);
    const year = years.find((row) => row.label === "2025-26");
    assert.deepEqual([year?.status, year?.profit, year?.closable], ["OPEN", "1100.00", true]);
    assert.equal((await closeYear({ ...actor(t), startYear: 2025, confirm: "2025" })).ok, false, "the year's name must be typed");
    const done = await closeYear({ ...actor(t), startYear: 2025, confirm: "2025-26" });
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.deepEqual([done.ok && done.profit, done.ok && done.lines], ["1100.00", 3]);

    const journal = await prisma.journal.findFirstOrThrow({ where: { organizationId: t.org.id, docType: "YEAR_CLOSE" }, include: { lines: { include: { account: true } } } });
    assert.equal(journal.businessDate.toISOString().slice(0, 10), "2026-06-30");
    assert.equal(journal.lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0), 0, "balanced");
    assert.deepEqual(await Promise.all([balance(t, (await role(t, "OTHER_INCOME")).id), balance(t, (await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, code: rent } })).id), balance(t, (await role(t, "RETAINED")).id)]), ["0.00", "0.00", "-1100.00"]);
    void income;
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: t.org.id } })).lockedThrough?.toISOString().slice(0, 10), "2026-06-30");

    // the period is locked: nothing can be posted into the closed year
    const refused = await postIncome({ ...actor(t), businessDate: "2026-06-30", accountCode: income, amount: "5.00", method: "CASH" });
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? "" : refused.message, /locked/);

    // reports still show the year's profit; the balance sheet and trial balance still balance with Retained Earnings holding it
    const ctx = { organizationId: t.org.id, branchIds: [t.branch.id], from: "2025-07-01", to: "2026-06-30", canProfit: true };
    assert.equal((await profitReport(ctx)).figures?.net, "1100.00");
    const trial = await trialBalanceReport(ctx);
    const sheet = await balanceSheet(ctx);
    assert.ok(trial.identities.every((check) => check.ok) && sheet.identities.every((check) => check.ok));
    assert.equal(sheet.sections.find((row) => row.key === "equity")?.rows.find((row) => String(row.name).startsWith("Retained"))?.amount, "1100.00");
    assert.equal((await listYears(t.org.id)).find((row) => row.label === "2025-26")?.status, "CLOSED");
    assert.equal((await closeYear({ ...actor(t), startYear: 2025, confirm: "2025-26" })).ok, false, "closed once");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a year that is not over, a year with nothing in it, and a year after an unclosed one are refused; the same key is the same close", async () => {
  await withTestOrg(async (t) => {
    const { income } = await aYear(t);
    const current = (await listYears(t.org.id)).find((row) => row.status === "CURRENT");
    assert.ok(current);
    assert.equal((await closeYear({ ...actor(t), startYear: current.startYear, confirm: current.label })).ok, false, "not over");
    assert.equal((await closeYear({ ...actor(t), startYear: 2020, confirm: "2020-21" })).ok, false, "nothing in it");
    // a posting in a later, finished year while 2025-26 is still open
    assert.equal((await postIncome({ ...actor(t), businessDate: "2026-07-05", accountCode: income, amount: "50.00", method: "CASH" })).ok, true);
    const later = await closeYear({ ...actor(t), startYear: 2026, confirm: "2026-27" });
    assert.equal(later.ok, false, "2026-27 is still running");
    const key = randomUUID();
    const first = await closeYear({ ...t.actor, idempotencyKey: key, startYear: 2025, confirm: "2025-26" });
    const again = await closeYear({ ...t.actor, idempotencyKey: key, startYear: 2025, confirm: "2025-26" });
    assert.deepEqual([first.ok, again.ok && again.replayed, first.ok && again.ok ? first.id === again.id : null], [true, true, true]);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id, docType: "YEAR_CLOSE" } }), 1);
  });
});

test("years are closed in order: the later finished year is refused while an earlier one still has postings, then both close", async () => {
  await withTestOrg(async (t) => {
    const income = (await role(t, "OTHER_INCOME")).code;
    for (const date of ["2024-10-10", "2025-09-10"]) {
      assert.equal((await postIncome({ ...actor(t), businessDate: date, accountCode: income, amount: "100.00", method: "CASH" })).ok, true);
    }
    const out = await closeYear({ ...actor(t), startYear: 2025, confirm: "2025-26" });
    assert.equal(out.ok, false);
    assert.match(out.ok ? "" : out.message, /earlier year/);
    assert.equal((await closeYear({ ...actor(t), startYear: 2024, confirm: "2024-25" })).ok, true);
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: t.org.id } })).lockedThrough?.toISOString().slice(0, 10), "2025-06-30");
    assert.equal((await closeYear({ ...actor(t), startYear: 2025, confirm: "2025-26" })).ok, true);
    assert.deepEqual((await listYears(t.org.id)).filter((row) => row.status === "CLOSED").map((row) => row.label).sort(), ["2024-25", "2025-26"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
