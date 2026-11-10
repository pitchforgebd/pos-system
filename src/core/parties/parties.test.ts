import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma, type PartyType } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import { post } from "../posting/journal.ts";
import { addDays, businessDate as today } from "../time/business-date.ts";
import { runTx } from "../tx/run.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { agingBuckets, partyBalance, partyBalances, partyStatement } from "./index.ts";

// P02 task 5: a party's balance, statement and ageing come from the journal lines and nowhere else (I8).

const D = (value: string) => new Prisma.Decimal(value);
const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];

/** Posts one entry between a party account and cash on a given day (any day: the test organization has no period limits). */
async function entry(t: T, input: { date: string; role: "AR" | "AP" | "CUSTOMER_ADVANCE" | "VENDOR_ADVANCE" | "COURIER_AR"; side: "debit" | "credit"; amount: string; partyType: PartyType; partyId: string; number?: string }) {
  const party = { type: input.partyType, id: input.partyId };
  const amount = D(input.amount);
  const zero = D("0");
  const partySide = input.side === "debit" ? { debit: amount, credit: zero } : { debit: zero, credit: amount };
  const cashSide = input.side === "debit" ? { debit: zero, credit: amount } : { debit: amount, credit: zero };
  return runTx((tx) =>
    post(tx, {
      organizationId: t.org.id,
      branchId: t.branch.id,
      businessDate: at(input.date),
      description: `${input.role} ${input.side} ${input.amount}`,
      createdById: t.owner.id,
      number: input.number ?? null,
      doc: { type: "JOURNAL", id: randomUUID() },
      lines: [
        { role: input.role, ...partySide, party },
        { role: "CASH", ...cashSide },
      ],
    }),
  );
}

async function open(t: T) {
  await prisma.organization.update({ where: { id: t.org.id }, data: { backdateDays: 100000 } });
}

test("a customer's balance is receivables minus receipts; their advance is a separate balance; other customers do not mix in", async () => {
  await withTestOrg(async (t) => {
    await open(t);
    const f = factories(t);
    const a = await f.customer();
    const b = await f.customer();
    const day = today();
    await entry(t, { date: addDays(day, -2), role: "AR", side: "debit", amount: "100.00", partyType: "CUSTOMER", partyId: a.id });
    await entry(t, { date: addDays(day, -1), role: "AR", side: "credit", amount: "30.00", partyType: "CUSTOMER", partyId: a.id });
    await entry(t, { date: day, role: "AR", side: "debit", amount: "5.50", partyType: "CUSTOMER", partyId: a.id });
    await entry(t, { date: day, role: "AR", side: "debit", amount: "999.00", partyType: "CUSTOMER", partyId: b.id });
    await entry(t, { date: day, role: "CUSTOMER_ADVANCE", side: "credit", amount: "40.00", partyType: "CUSTOMER", partyId: a.id });

    const q = { organizationId: t.org.id, partyType: "CUSTOMER" as const, partyId: a.id };
    assert.equal((await partyBalance(prisma, q)).toFixed(2), "75.50", "100 - 30 + 5.50 owed by the customer");
    assert.equal((await partyBalance(prisma, { ...q, account: "ADVANCE" })).toFixed(2), "40.00", "the advance is money the shop holds for the customer");
    assert.equal((await partyBalance(prisma, { ...q, asOf: addDays(day, -2) })).toFixed(2), "100.00", "as of an earlier day");
    assert.equal((await partyBalance(prisma, { ...q, asOf: addDays(day, -1) })).toFixed(2), "70.00");
    assert.equal((await partyBalance(prisma, { ...q, partyId: b.id })).toFixed(2), "999.00");
    assert.equal((await partyBalance(prisma, { ...q, partyId: randomUUID() })).toFixed(2), "0.00", "a party with no lines owes nothing");
  });
});

test("a vendor is the other way round: the balance is what the shop owes, an advance to the vendor is an asset", async () => {
  await withTestOrg(async (t) => {
    await open(t);
    const vendor = await factories(t).vendor();
    const day = today();
    await entry(t, { date: day, role: "AP", side: "credit", amount: "200.00", partyType: "VENDOR", partyId: vendor.id });
    await entry(t, { date: day, role: "AP", side: "debit", amount: "50.00", partyType: "VENDOR", partyId: vendor.id });
    await entry(t, { date: day, role: "VENDOR_ADVANCE", side: "debit", amount: "20.00", partyType: "VENDOR", partyId: vendor.id });
    const q = { organizationId: t.org.id, partyType: "VENDOR" as const, partyId: vendor.id };
    assert.equal((await partyBalance(prisma, q)).toFixed(2), "150.00", "owed to the vendor");
    assert.equal((await partyBalance(prisma, { ...q, account: "ADVANCE" })).toFixed(2), "20.00", "paid ahead to the vendor");
  });
});

test("a courier balance is what the courier still owes the shop", async () => {
  await withTestOrg(async (t) => {
    await open(t);
    const courier = await prisma.courier.create({ data: { organizationId: t.org.id, name: "Fast" } });
    await entry(t, { date: today(), role: "COURIER_AR", side: "debit", amount: "500.00", partyType: "COURIER", partyId: courier.id });
    await entry(t, { date: today(), role: "COURIER_AR", side: "credit", amount: "120.00", partyType: "COURIER", partyId: courier.id });
    assert.equal((await partyBalance(prisma, { organizationId: t.org.id, partyType: "COURIER", partyId: courier.id })).toFixed(2), "380.00");
  });
});

test("partyBalances answers for exactly the parties asked about (a list shows its own rows, not the whole book)", async () => {
  await withTestOrg(async (t) => {
    await open(t);
    const f = factories(t);
    const [a, b, c] = [await f.customer(), await f.customer(), await f.customer()];
    await entry(t, { date: today(), role: "AR", side: "debit", amount: "10.00", partyType: "CUSTOMER", partyId: a.id });
    await entry(t, { date: today(), role: "AR", side: "debit", amount: "20.00", partyType: "CUSTOMER", partyId: b.id });
    await entry(t, { date: today(), role: "CUSTOMER_ADVANCE", side: "credit", amount: "7.00", partyType: "CUSTOMER", partyId: b.id });
    const got = await partyBalances(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyIds: [a.id, b.id, c.id] });
    assert.deepEqual([...got.keys()].sort(), [a.id, b.id, c.id].sort(), "every asked party has an answer, even with no lines");
    assert.equal(got.get(a.id)?.balance.toFixed(2), "10.00");
    assert.equal(got.get(b.id)?.balance.toFixed(2), "20.00");
    assert.equal(got.get(b.id)?.advance.toFixed(2), "7.00");
    assert.equal(got.get(c.id)?.balance.toFixed(2), "0.00");
    const none = await partyBalances(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyIds: [] });
    assert.equal(none.size, 0);
  });
});

test("a statement has the opening balance, every line of the period in order with a running balance, and the closing balance", async () => {
  await withTestOrg(async (t) => {
    await open(t);
    const customer = await factories(t).customer();
    const day = today();
    const base = { partyType: "CUSTOMER" as const, partyId: customer.id, role: "AR" as const };
    await entry(t, { ...base, date: addDays(day, -10), side: "debit", amount: "100.00", number: "S-1" });
    await entry(t, { ...base, date: addDays(day, -5), side: "debit", amount: "50.00", number: "S-2" });
    await entry(t, { ...base, date: addDays(day, -4), side: "credit", amount: "60.00", number: "S-3" });
    await entry(t, { ...base, date: addDays(day, -1), side: "debit", amount: "10.00", number: "S-4" });
    await entry(t, { ...base, date: addDays(day, 0), side: "credit", amount: "5.00", number: "S-5" });

    const s = await partyStatement(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customer.id, from: addDays(day, -5), to: addDays(day, -1) });
    assert.equal(s.opening.toFixed(2), "100.00", "what stood before the period");
    assert.deepEqual(s.rows.map((r) => [r.reference, r.debit.toFixed(2), r.credit.toFixed(2), r.balance.toFixed(2)]), [
      ["S-2", "50.00", "0.00", "150.00"],
      ["S-3", "0.00", "60.00", "90.00"],
      ["S-4", "10.00", "0.00", "100.00"],
    ]);
    assert.equal(s.closing.toFixed(2), "100.00");
    assert.equal(s.closing.toFixed(2), (await partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customer.id, asOf: addDays(day, -1) })).toFixed(2), "the statement's closing balance is the balance of that day");
    const empty = await partyStatement(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customer.id, from: addDays(day, -3), to: addDays(day, -2) });
    assert.deepEqual([empty.opening.toFixed(2), empty.rows.length, empty.closing.toFixed(2)], ["90.00", 0, "90.00"]);
  });
});

test("ageing applies receipts to the oldest debt first and buckets what is left by its age", async () => {
  await withTestOrg(async (t) => {
    await open(t);
    const customer = await factories(t).customer();
    const day = today();
    const base = { partyType: "CUSTOMER" as const, partyId: customer.id, role: "AR" as const };
    await entry(t, { ...base, date: addDays(day, -120), side: "debit", amount: "70.00" }); //  over 90 days
    await entry(t, { ...base, date: addDays(day, -75), side: "debit", amount: "40.00" }); //  61-90
    await entry(t, { ...base, date: addDays(day, -45), side: "debit", amount: "100.00" }); // 31-60
    await entry(t, { ...base, date: addDays(day, -20), side: "debit", amount: "50.00" }); //  0-30
    await entry(t, { ...base, date: addDays(day, -10), side: "credit", amount: "120.00" }); // pays the 70, then 50 of the 40+...: 70 + 40 + 10
    const aging = await agingBuckets(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customer.id, asOf: day });
    // owed 260 - 120 paid = 140: the 70 and the 40 are paid, 10 of the 100 is paid, so 90 is 31-60 and 50 is 0-30
    assert.deepEqual(aging.buckets.map((b) => [b.label, b.amount.toFixed(2)]), [
      ["0-30", "50.00"],
      ["31-60", "90.00"],
      ["61-90", "0.00"],
      ["90+", "0.00"],
    ]);
    assert.equal(aging.total.toFixed(2), "140.00");
    assert.equal(aging.total.toFixed(2), (await partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customer.id })).toFixed(2), "ageing adds up to the balance (I8)");
    assert.equal(aging.unapplied.toFixed(2), "0.00");
  });
});

test("ageing with more paid than owed has nothing outstanding and says how much is left over", async () => {
  await withTestOrg(async (t) => {
    await open(t);
    const customer = await factories(t).customer();
    const base = { partyType: "CUSTOMER" as const, partyId: customer.id, role: "AR" as const };
    await entry(t, { ...base, date: addDays(today(), -40), side: "debit", amount: "30.00" });
    await entry(t, { ...base, date: addDays(today(), -3), side: "credit", amount: "100.00" });
    const aging = await agingBuckets(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customer.id, asOf: today() });
    assert.equal(aging.total.toFixed(2), "0.00");
    assert.equal(aging.unapplied.toFixed(2), "70.00");
    assert.ok(aging.buckets.every((b) => b.amount.isZero()));
  });
});

test("a vendor's ageing buckets the bills still unpaid, oldest paid first", async () => {
  await withTestOrg(async (t) => {
    await open(t);
    const vendor = await factories(t).vendor();
    const base = { partyType: "VENDOR" as const, partyId: vendor.id, role: "AP" as const };
    await entry(t, { ...base, date: addDays(today(), -50), side: "credit", amount: "80.00" });
    await entry(t, { ...base, date: addDays(today(), -5), side: "credit", amount: "20.00" });
    await entry(t, { ...base, date: addDays(today(), -2), side: "debit", amount: "30.00" });
    const aging = await agingBuckets(prisma, { organizationId: t.org.id, partyType: "VENDOR", partyId: vendor.id, asOf: today() });
    assert.deepEqual(aging.buckets.map((b) => b.amount.toFixed(2)), ["20.00", "50.00", "0.00", "0.00"]);
    assert.equal(aging.total.toFixed(2), "70.00");
  });
});
