import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { partyBalance } from "../../core/parties/index.ts";
import { BooksReconcileError, assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { addMonths, addOpeningAsset, assetRegister, buyAsset, depreciationFor, depreciationReminder, disposeAsset, getAsset, previewDepreciation, runDepreciation } from "./assets.ts";
import { companyWorth } from "./worth.ts";

// P09 (#36-#38, D8): an asset is bought or entered as opening; each month one journal writes off the straight line, the last month takes the
// rounding, and after its life nothing more; a month is depreciated once and in order; selling puts the gain or loss in the books.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T, key = randomUUID()) => ({ ...t.actor, idempotencyKey: key });
const roleAccount = async (t: T, role: string) => (await prisma.accountRole.findFirstOrThrow({ where: { organizationId: t.org.id, role: role as never }, select: { accountId: true } })).accountId;
const thisMonth = () => today().slice(0, 7);
const d = (value: string) => new Prisma.Decimal(value);

async function buy(t: T, input: { cost: string; months: number; salvage?: string; monthsAgo: number; name?: string }) {
  const purchaseDate = `${addMonths(thisMonth(), -input.monthsAgo)}-01`;
  const made = await buyAsset({ ...actor(t), name: input.name ?? "Delivery van", category: "VEHICLE", purchaseDate, cost: input.cost, salvageValue: input.salvage, usefulLifeMonths: input.months, paidWith: "ACCOUNT", moneyAccountId: await roleAccount(t, "CASH") });
  assert.equal(made.ok, true, JSON.stringify(made));
  return { id: made.ok ? made.id : "", start: purchaseDate.slice(0, 7) };
}

const lines = async (t: T, docType: string) =>
  (await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType } }, include: { account: { include: { roles: true } } } }))
    .map((l) => `${l.account.roles[0]?.role ?? l.account.code}:${l.debit.toFixed(2)}/${l.credit.toFixed(2)}`)
    .sort();

test("the straight line: 1,20,000 over 60 months with nothing left is 2,000 a month; the last month takes the rounding; after its life nothing", () => {
  const van = { cost: d("120000"), salvageValue: d("0"), openingDepreciation: d("0"), depreciationStartMonth: "2020-01", depreciationMonths: 60 };
  assert.equal(depreciationFor(van, d("0"), "2020-01").toFixed(2), "2000.00");
  assert.equal(depreciationFor(van, d("118000"), "2024-12").toFixed(2), "2000.00", "the 60th month");
  assert.equal(depreciationFor(van, d("120000"), "2025-01").toFixed(2), "0.00", "the 61st month");
  assert.equal(depreciationFor(van, d("0"), "2019-12").toFixed(2), "0.00", "before it was bought");
  assert.equal(depreciationFor(van, d("2000"), "2020-03").toFixed(2), "4000.00", "a missed month is caught up");
  const desk = { cost: d("1000"), salvageValue: d("0"), openingDepreciation: d("0"), depreciationStartMonth: "2020-01", depreciationMonths: 3 };
  assert.deepEqual(["2020-01", "2020-02", "2020-03"].reduce<{ acc: Prisma.Decimal; out: string[] }>((s, month) => {
    const amount = depreciationFor(desk, s.acc, month);
    return { acc: s.acc.plus(amount), out: [...s.out, amount.toFixed(2)] };
  }, { acc: d("0"), out: [] }).out, ["333.33", "333.33", "333.34"]);
  const fridge = { cost: d("10000"), salvageValue: d("1000"), openingDepreciation: d("0"), depreciationStartMonth: "2020-01", depreciationMonths: 12 };
  assert.equal(depreciationFor(fridge, d("8250"), "2020-12").toFixed(2), "750.00", "down to the value left at the end, not to zero");
});

test("a van of 1,20,000 for 60 months: 60 runs of 2,000, book value 0, the 61st month writes off nothing; a month twice or out of order is refused", async () => {
  await withTestOrg(async (t) => {
    const van = await buy(t, { cost: "120000.00", months: 60, monthsAgo: 61 });
    assert.deepEqual(await lines(t, "ASSET_PURCHASE"), ["CASH:0.00/120000.00", "FIXED_ASSET:120000.00/0.00"]);
    const first = await runDepreciation({ ...actor(t), month: van.start });
    assert.deepEqual([first.ok, first.ok ? first.total : null, first.ok ? first.count : null], [true, "2000.00", 1]);
    const twice = await runDepreciation({ ...actor(t), month: van.start });
    assert.deepEqual([twice.ok, twice.ok ? null : twice.status], [false, 409], "the same month again");
    for (let k = 1; k < 60; k += 1) {
      const done = await runDepreciation({ ...actor(t), month: addMonths(van.start, k) });
      assert.equal(done.ok && done.total, "2000.00", `month ${k + 1}: ${JSON.stringify(done)}`);
    }
    const back = await runDepreciation({ ...actor(t), month: addMonths(van.start, 30) });
    assert.equal(back.ok, false, "a month before the last run");
    const after = await getAsset(t.org.id, van.id);
    assert.deepEqual([after?.accumulated, after?.bookValue], ["120000.00", "0.00"]);
    const sixtyFirst = addMonths(van.start, 60);
    assert.deepEqual((await previewDepreciation(t.org.id, sixtyFirst)).rows, [], "the 61st month");
    assert.equal((await runDepreciation({ ...actor(t), month: sixtyFirst })).ok, false, "nothing to post");
    assert.equal(await prisma.depreciationRun.count({ where: { organizationId: t.org.id } }), 60);
    const journal = await prisma.journal.findFirstOrThrow({ where: { organizationId: t.org.id, docType: "DEPRECIATION" }, orderBy: { businessDate: "asc" }, include: { lines: true } });
    assert.ok(journal.lines.every((line) => line.assetId === van.id), "every line names the asset");
    assert.match(journal.number ?? "", /^DEP-/);
    assert.equal((await runDepreciation({ ...actor(t), month: addMonths(thisMonth(), 1) })).ok, false, "a month that has not started");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("one run covers every active asset in one journal; an odd cost puts the rounding in its last month", async () => {
  await withTestOrg(async (t) => {
    const desk = await buy(t, { cost: "1000.00", months: 3, monthsAgo: 4, name: "Desk" });
    const pc = await buy(t, { cost: "36000.00", months: 36, monthsAgo: 4, name: "Computer" });
    const amounts: string[] = [];
    for (let k = 0; k < 3; k += 1) {
      const done = await runDepreciation({ ...actor(t), month: addMonths(desk.start, k) });
      assert.equal(done.ok, true, JSON.stringify(done));
      amounts.push(done.ok ? (done.total ?? "") : "");
    }
    assert.deepEqual(amounts, ["1333.33", "1333.33", "1333.34"], "desk 333.33/333.33/333.34 and computer 1000 each month");
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id, docType: "DEPRECIATION" } }), 3);
    const fourth = await runDepreciation({ ...actor(t), month: addMonths(desk.start, 3) });
    assert.deepEqual([fourth.ok && fourth.total, fourth.ok && fourth.count], ["1000.00", 1], "the desk is done, only the computer");
    assert.deepEqual([(await getAsset(t.org.id, desk.id))?.bookValue, (await getAsset(t.org.id, pc.id))?.bookValue], ["0.00", "32000.00"]);
    const register = await assetRegister(t.org.id);
    assert.deepEqual(register.totals, { count: 2, cost: "37000.00", accumulated: "5000.00", bookValue: "32000.00" });
    assert.deepEqual(register.byCategory.map((row) => [row.label, row.count, row.bookValue]), [["Vehicle", 2, "32000.00"]]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("selling: above what it is worth is Other income, below is a loss; a written-off asset brings nothing; a sold asset is no longer depreciated", async () => {
  await withTestOrg(async (t) => {
    const van = await buy(t, { cost: "10000.00", months: 10, monthsAgo: 6 });
    const fridge = await buy(t, { cost: "6000.00", months: 10, monthsAgo: 6, name: "Fridge" });
    for (let k = 0; k < 4; k += 1) {
      assert.equal((await runDepreciation({ ...actor(t), month: addMonths(van.start, k) })).ok, true);
    }
    // van: cost 10000, written off 4000, worth 6000, sold for 7000 into the bank: gain 1000
    const bank = await roleAccount(t, "BANK:DEFAULT");
    const sold = await disposeAsset({ ...actor(t), assetId: van.id, businessDate: today(), amount: "7000.00", moneyAccountId: bank, note: "Sold to a dealer" });
    assert.deepEqual([sold.ok, sold.ok ? sold.gain : null], [true, "1000.00"], JSON.stringify(sold));
    assert.deepEqual(await lines(t, "ASSET_DISPOSAL"), ["ACCUM_DEPR:4000.00/0.00", "BANK:DEFAULT:7000.00/0.00", "FIXED_ASSET:0.00/10000.00", "OTHER_INCOME:0.00/1000.00"]);
    assert.equal((await disposeAsset({ ...actor(t), assetId: van.id, businessDate: today(), amount: "1.00", moneyAccountId: bank })).ok, false, "once");
    // fridge: worth 3600, written off for nothing: loss 3600
    const gone = await disposeAsset({ ...actor(t), assetId: fridge.id, businessDate: today() });
    assert.deepEqual([gone.ok, gone.ok ? gone.gain : null], [true, "-3600.00"]);
    const fridgeLines = (await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "ASSET_DISPOSAL", docId: fridge.id } }, include: { account: { include: { roles: true } } } })).map((l) => `${l.account.roles[0]?.role}:${l.debit.toFixed(2)}/${l.credit.toFixed(2)}`).sort();
    assert.deepEqual(fridgeLines, ["ACCUM_DEPR:2400.00/0.00", "FIXED_ASSET:0.00/6000.00", "MISC:3600.00/0.00"]);
    assert.deepEqual((await previewDepreciation(t.org.id, addMonths(van.start, 4))).rows, [], "neither is depreciated any more");
    const register = await assetRegister(t.org.id);
    assert.deepEqual([register.totals.count, register.rows.map((row) => row.status)], [0, ["DISPOSED", "DISPOSED"]]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("an asset the shop already had: cost, what was written off and the opening equity; what is left is spread over the months still to come", async () => {
  await withTestOrg(async (t) => {
    const purchaseDate = `${addMonths(thisMonth(), -30)}-01`;
    const made = await addOpeningAsset({ ...actor(t), name: "Generator", category: "WAREHOUSE_EQUIPMENT", purchaseDate, cost: "50000.00", usefulLifeMonths: 50, accumulated: "20000.00", asOf: today() });
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.match(made.ok ? (made.code ?? "") : "", /^AST-/);
    assert.deepEqual(await lines(t, "ASSET_OPENING"), ["ACCUM_DEPR:0.00/20000.00", "FIXED_ASSET:50000.00/0.00", "OPENING_EQUITY:0.00/30000.00"]);
    const asset = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: made.ok ? made.id : "" } });
    // bought 30 months ago, 50 months of life: from next month, 19 months are left for 30000
    assert.deepEqual([asset.depreciationStartMonth, asset.depreciationMonths], [addMonths(thisMonth(), 1), 19]);
    assert.equal((await previewDepreciation(t.org.id, thisMonth())).rows.length, 0, "nothing this month: it came in with what was written off up to now");
    assert.equal(depreciationFor(asset, d("20000"), addMonths(thisMonth(), 1)).toFixed(2), "1578.95");
    assert.equal((await addOpeningAsset({ ...actor(t), name: "Bad", category: "OTHER", purchaseDate, cost: "100.00", usefulLifeMonths: 10, accumulated: "101.00" })).ok, false, "more written off than it cost");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("bought on credit: the vendor is owed it; the company worth adds up and does not change when cash becomes an asset", async () => {
  await withTestOrg(async (t) => {
    const vendor = await factories(t).vendor();
    const before = await companyWorth(t.org.id);
    const made = await buyAsset({ ...actor(t), code: "SHELF-1", name: "Shelving", category: "FURNITURE", purchaseDate: today(), cost: "8000.00", usefulLifeMonths: 40, paidWith: "CREDIT", vendorId: vendor.id, location: "Back store" });
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.equal(made.ok && made.code, "SHELF-1");
    assert.equal((await partyBalance(prisma, { organizationId: t.org.id, partyType: "VENDOR", partyId: vendor.id })).abs().toFixed(2), "8000.00");
    assert.deepEqual(await lines(t, "ASSET_PURCHASE"), ["AP:0.00/8000.00", "FIXED_ASSET:8000.00/0.00"]);
    const worth = await companyWorth(t.org.id);
    const line = (list: typeof worth.owns, key: string) => list.find((row) => row.key === key)?.amount;
    assert.deepEqual([line(worth.owns, "fixedAssets"), line(worth.owes, "vendors"), worth.net], ["8000.00", "8000.00", before.net]);
    const sum = (list: typeof worth.owns) => list.reduce((total, row) => total.plus(row.amount), d("0")).toFixed(2);
    assert.deepEqual([sum(worth.owns), sum(worth.owes)], [worth.assets, worth.liabilities]);
    assert.equal((await buyAsset({ ...actor(t), code: "SHELF-1", name: "Shelving 2", category: "FURNITURE", purchaseDate: today(), cost: "1.00", usefulLifeMonths: 4, paidWith: "CREDIT", vendorId: vendor.id })).ok, false, "a code is used once");
    assert.equal((await buyAsset({ ...actor(t), name: "Future", category: "OTHER", purchaseDate: addMonths(thisMonth(), 2) + "-01", cost: "1.00", usefulLifeMonths: 4, paidWith: "CREDIT", vendorId: vendor.id })).ok, false, "not in the future");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("I19: an asset whose lines no longer add up to its cost fails the books check", async () => {
  await withTestOrg(async (t) => {
    const van = await buy(t, { cost: "5000.00", months: 10, monthsAgo: 1 });
    await prisma.fixedAsset.update({ where: { id: van.id }, data: { cost: new Prisma.Decimal("5100.00") } });
    await assert.rejects(assertBooksReconcile(t.org.id, prisma), (error: unknown) => error instanceof BooksReconcileError && error.findings.some((finding) => finding.invariant === "I19"));
    await prisma.fixedAsset.update({ where: { id: van.id }, data: { cost: new Prisma.Decimal("5000.00") } });
    await assertBooksReconcile(t.org.id, prisma);
  });
});

test("the dashboard reminder: last month's depreciation while it is not posted, nothing once it is", async () => {
  await withTestOrg(async (t) => {
    assert.equal(await depreciationReminder(t.org.id), null, "no asset, no reminder");
    await buy(t, { cost: "24000.00", months: 24, monthsAgo: 2 });
    const lastMonth = addMonths(thisMonth(), -1);
    const waiting = await depreciationReminder(t.org.id);
    assert.equal(waiting?.month, lastMonth);
    assert.equal((await runDepreciation({ ...actor(t), month: addMonths(thisMonth(), -2) })).ok, true);
    assert.deepEqual([(await depreciationReminder(t.org.id))?.month, (await depreciationReminder(t.org.id))?.total], [lastMonth, "1000.00"], "the month before does not clear last month");
    assert.equal((await runDepreciation({ ...actor(t), month: lastMonth })).ok, true);
    const now = await depreciationReminder(t.org.id);
    assert.ok(now === null || now.month === thisMonth(), "last month is done (this month only on its last day)");
  });
});
