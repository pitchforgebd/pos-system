import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { addDays } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { buildAgriDay, EXPECTED } from "../../tests/golden/agri-day.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { postIncome } from "../accounting/books.ts";
import { reconciliation } from "./reconcile.ts";
import { ensureSnapshots, snapshotDifferences } from "./snapshots.ts";

// P11 tasks 5-6: a day is snapshotted once it is over; a posting dated back into a day marks it and the later days stale and they are made again; the
// reconciliation finds a snapshot that no longer agrees with the ledger.

const tomorrow = (day: string) => new Date(`${addDays(day, 1)}T06:00:00.000Z`);
const at = async (organizationId: string, branchId: string, date: string) => prisma.dailySnapshot.findFirstOrThrow({ where: { organizationId, branchId, businessDate: new Date(`${date}T00:00:00.000Z`) } });

test("the snapshots of the golden day and the day before are the books at their ends; asked again, nothing is made twice", async () => {
  await withTestOrg(async (t) => {
    const { day } = await buildAgriDay(t);
    const before = addDays(day, -1);
    const first = await ensureSnapshots(t.org.id, tomorrow(day));
    assert.equal(first.made, 2, "the day before and the day");
    const [a, b] = [await at(t.org.id, t.branch.id, before), await at(t.org.id, t.branch.id, day)];
    // the day before: 50,000 in the cash, the opening stock 100 x 1,000 + 50 x 300 + 200 x 50
    assert.deepEqual([a.cash.toFixed(2), a.bank.toFixed(2), a.stockValue.toFixed(2), a.receivable.toFixed(2), a.payable.toFixed(2), a.courierOwes.toFixed(2)], ["50000.00", "0.00", "125000.00", "0.00", "0.00", "0.00"]);
    // the golden day, as worked out by hand
    assert.deepEqual([b.cash.toFixed(2), b.bank.toFixed(2), b.stockValue.toFixed(2), b.receivable.toFixed(2), b.payable.toFixed(2), b.courierOwes.toFixed(2)], [EXPECTED.cash.closing, EXPECTED.bank.closing, EXPECTED.stock.value, EXPECTED.due.customersOwe, EXPECTED.due.vendorOwed, EXPECTED.condition.closing]);
    assert.equal((await ensureSnapshots(t.org.id, tomorrow(day))).made, 0);
    assert.equal(await prisma.dailySnapshot.count({ where: { organizationId: t.org.id } }), 2);
    assert.equal((await ensureSnapshots(t.org.id, new Date(`${day}T06:00:00.000Z`))).made, 0, "on the day itself nothing new is due: today is not snapshotted until it is over");
  });
});

test("a posting dated back into a day marks that day and the later ones stale; they are made again with the new figures", async () => {
  await withTestOrg(async (t) => {
    const { day } = await buildAgriDay(t);
    const before = addDays(day, -1);
    await ensureSnapshots(t.org.id, tomorrow(day));
    const income = await postIncome({ ...t.actor, idempotencyKey: randomUUID(), businessDate: before, accountCode: (await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, roles: { some: { role: "OTHER_INCOME" } } } })).code, amount: "700.00", method: "CASH" });
    assert.equal(income.ok, true, JSON.stringify(income));
    const stale = await prisma.dailySnapshot.findMany({ where: { organizationId: t.org.id }, orderBy: { businessDate: "asc" } });
    assert.deepEqual(stale.map((row) => row.stale), [true, true], "the day it was dated into and the day after");
    assert.equal((await ensureSnapshots(t.org.id, tomorrow(day))).made, 2);
    const [a, b] = [await at(t.org.id, t.branch.id, before), await at(t.org.id, t.branch.id, day)];
    assert.deepEqual([a.cash.toFixed(2), b.cash.toFixed(2), a.stale, b.stale], ["50700.00", "38600.00", false, false]);
  });
});

test("the reconciliation: all green on the golden day; a snapshot that no longer agrees with the ledger turns it red, naming the day", async () => {
  await withTestOrg(async (t) => {
    const { day } = await buildAgriDay(t);
    await ensureSnapshots(t.org.id, tomorrow(day));
    const clean = await reconciliation(t.org.id, day);
    assert.deepEqual([clean.ok, clean.red, clean.books.findings.length, clean.snapshots.differences.length], [true, 0, 0, 0], JSON.stringify(clean.reports.flatMap((row) => row.checks.filter((check) => !check.ok))));
    assert.ok(clean.reports.length >= 15, "the identities of the reports are in it");
    assert.ok(clean.snapshots.checked >= 2);

    // something moved under a snapshot without the engine noticing: the cash of the day is said to be 1
    await prisma.dailySnapshot.updateMany({ where: { organizationId: t.org.id, businessDate: new Date(`${day}T00:00:00.000Z`) }, data: { cash: "1.00" } });
    const red = await snapshotDifferences(t.org.id);
    assert.deepEqual(red.differences.map((row) => [row.date, row.field, row.stored, row.now]), [[day, "cash", "1.00", EXPECTED.cash.closing]]);
    const result = await reconciliation(t.org.id, day);
    assert.deepEqual([result.ok, result.red], [false, 1]);
  });
});
