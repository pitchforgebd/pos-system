import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { runTx } from "../tx/run.ts";
import { partyLineViolations } from "../posting/invariants.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { partyBalance } from "./index.ts";
import { comparePartyLedgers, repairLegacyParties } from "./legacy.ts";

// P02 task 6: before this phase a customer's or vendor's balance was kept in customer_ledgers / supplier_ledgers and the
// journal lines had no party. The balance now comes from the journal only, so databases that already hold such data are
// brought over once: the party is written on the old receivable and payable lines (found through the document each journal posted),
// advances that sat on the receivable are moved to Customer Advance by a visible journal, and then each party's old ledger balance
// is compared with the journal's. These tests build data the way the old code left it, with direct inserts.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const day = new Date("2026-10-01T00:00:00.000Z");

async function roleAccount(t: T, role: string) {
  return (await prisma.accountRole.findUniqueOrThrow({ where: { organizationId_role: { organizationId: t.org.id, role } } })).accountId;
}

/** A journal the old way: lines without a party, no docType, no docId. */
async function oldJournal(t: T, description: string, lines: Array<[string, "debit" | "credit", string]>) {
  const accountIds = new Map<string, string>();
  for (const [role] of lines) {
    accountIds.set(role, await roleAccount(t, role));
  }
  return prisma.journal.create({
    data: {
      organizationId: t.org.id, branchId: t.branch.id, businessDate: day, status: "POSTED", description,
      lines: { create: lines.map(([role, side, amount]) => ({ organizationId: t.org.id, accountId: accountIds.get(role) as string, [side]: amount, businessDate: day, branchId: t.branch.id })) },
    },
  });
}

async function legacyShop(t: T) {
  const f = factories(t);
  const [c1, c2, c3] = [await f.customer({ name: "Rahim" }), await f.customer({ name: "Karim" }), await f.customer({ name: "Nobody" })];
  const v1 = await f.vendor({ name: "Old Mill" });
  const ledger = (customerId: string, entryType: "SALE" | "PAYMENT" | "ADVANCE" | "OPENING" | "RETURN", side: "debit" | "credit", amount: string, referenceType: string, referenceId: string) =>
    prisma.customerLedger.create({ data: { organizationId: t.org.id, branchId: t.branch.id, customerId, businessDate: day, entryType, [side]: amount, referenceType, referenceId } });

  // Rahim: sold 100 on credit, paid 30, advance 80, opening due 50  => net 40 (owes 40)
  const sale = await oldJournal(t, "Sale", [["AR", "debit", "100.00"], ["SALES", "credit", "100.00"]]);
  const saleRow = await prisma.sale.create({ data: { organizationId: t.org.id, branchId: t.branch.id, customerId: c1.id, status: "POSTED", total: "100.00", businessDate: day, journalId: sale.id } });
  await ledger(c1.id, "SALE", "debit", "100.00", "sale", saleRow.id);
  const pay = await oldJournal(t, "Customer payment", [["CASH", "debit", "30.00"], ["AR", "credit", "30.00"]]);
  const payRow = await prisma.customerPayment.create({ data: { organizationId: t.org.id, branchId: t.branch.id, customerId: c1.id, number: "PAY-OLD-1", businessDate: day, method: "CASH", amount: "30.00", journalId: pay.id } });
  await ledger(c1.id, "PAYMENT", "credit", "30.00", "customer_payment", payRow.id);
  const adv = await oldJournal(t, "Customer advance", [["CASH", "debit", "80.00"], ["AR", "credit", "80.00"]]);
  const advRow = await prisma.customerAdvance.create({ data: { organizationId: t.org.id, branchId: t.branch.id, customerId: c1.id, businessDate: day, method: "CASH", amount: "80.00", journalId: adv.id } });
  await ledger(c1.id, "ADVANCE", "credit", "80.00", "customer_advance", advRow.id);
  await oldJournal(t, "Customer opening Rahim", [["AR", "debit", "50.00"], ["CAPITAL", "credit", "50.00"]]);
  await ledger(c1.id, "OPENING", "debit", "50.00", "customer", c1.id);

  // Karim: sold 20 on credit, advance 90 => net -70 (the shop holds 70 for him)
  const sale2 = await oldJournal(t, "Sale", [["AR", "debit", "20.00"], ["SALES", "credit", "20.00"]]);
  const sale2Row = await prisma.sale.create({ data: { organizationId: t.org.id, branchId: t.branch.id, customerId: c2.id, status: "POSTED", total: "20.00", businessDate: day, journalId: sale2.id } });
  await ledger(c2.id, "SALE", "debit", "20.00", "sale", sale2Row.id);
  const adv2 = await oldJournal(t, "Customer advance", [["CASH", "debit", "90.00"], ["AR", "credit", "90.00"]]);
  const adv2Row = await prisma.customerAdvance.create({ data: { organizationId: t.org.id, branchId: t.branch.id, customerId: c2.id, businessDate: day, method: "CASH", amount: "90.00", journalId: adv2.id } });
  await ledger(c2.id, "ADVANCE", "credit", "90.00", "customer_advance", adv2Row.id);

  // Nobody: an opening due that was written to the old ledger without any journal (no branch at the time)
  await ledger(c3.id, "OPENING", "debit", "25.00", "customer", c3.id);

  // Old Mill: bought 200, paid 50, opening payable 30 => owes 180
  const buy = await oldJournal(t, "Purchase", [["INVENTORY", "debit", "200.00"], ["AP", "credit", "200.00"]]);
  const buyRow = await prisma.purchase.create({ data: { organizationId: t.org.id, branchId: t.branch.id, supplierId: v1.id, status: "RECEIVED", total: "200.00", businessDate: day, journalId: buy.id } });
  await prisma.supplierLedger.create({ data: { organizationId: t.org.id, branchId: t.branch.id, supplierId: v1.id, businessDate: day, entryType: "PURCHASE", credit: "200.00", referenceType: "purchase", referenceId: buyRow.id } });
  const spay = await oldJournal(t, "Supplier payment", [["AP", "debit", "50.00"], ["CASH", "credit", "50.00"]]);
  const spayRow = await prisma.supplierPayment.create({ data: { organizationId: t.org.id, branchId: t.branch.id, supplierId: v1.id, number: "PAY-OLD-2", businessDate: day, method: "CASH", amount: "50.00", journalId: spay.id } });
  await prisma.supplierLedger.create({ data: { organizationId: t.org.id, branchId: t.branch.id, supplierId: v1.id, businessDate: day, entryType: "PAYMENT", debit: "50.00", referenceType: "supplier_payment", referenceId: spayRow.id } });
  await oldJournal(t, "Supplier opening Old Mill", [["CAPITAL", "debit", "30.00"], ["AP", "credit", "30.00"]]);
  await prisma.supplierLedger.create({ data: { organizationId: t.org.id, branchId: t.branch.id, supplierId: v1.id, businessDate: day, entryType: "OPENING", credit: "30.00", referenceType: "supplier", referenceId: v1.id } });
  return { c1, c2, c3, v1, sale, adv };
}

test("before the repair the journal knows no parties, so the comparison finds every party with a balance out of line", async () => {
  await withTestOrg(async (t) => {
    const { c1, v1 } = await legacyShop(t);
    const report = await comparePartyLedgers(prisma, t.org.id);
    assert.equal(report.checked.customers, 3);
    assert.equal(report.checked.suppliers, 1);
    const names = [...report.customers, ...report.suppliers].map((row) => row.partyId);
    assert.ok(names.includes(c1.id) && names.includes(v1.id));
    assert.ok((await partyLineViolations(prisma, t.org.id)).length > 0, "the old receivable and payable lines have no party");
  });
});

test("repairing writes the party on the old lines, moves held advances to Customer Advance, and the balances then match", async () => {
  await withTestOrg(async (t) => {
    const { c1, c2, c3, v1, sale } = await legacyShop(t);
    const done = await runTx((tx) => repairLegacyParties(tx, { organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id }));
    assert.ok(done.linesStamped >= 7, `stamped ${done.linesStamped}`);
    assert.equal(done.advancesMoved, 1, "Karim's net -70 is an advance the shop holds");

    const q = (partyType: "CUSTOMER" | "VENDOR", partyId: string, account?: "ADVANCE") => partyBalance(prisma, { organizationId: t.org.id, partyType, partyId, account }).then((v) => v.toFixed(2));
    assert.equal(await q("CUSTOMER", c1.id), "40.00", "Rahim: 100 - 30 - 80 + 50");
    assert.equal(await q("CUSTOMER", c2.id), "0.00", "Karim owes nothing: the 20 was set against his advance");
    assert.equal(await q("CUSTOMER", c2.id, "ADVANCE"), "70.00", "and the shop holds 70 for him");
    assert.equal(await q("VENDOR", v1.id), "180.00");
    assert.equal(await q("CUSTOMER", c3.id), "0.00", "no journal ever existed for this opening");

    const report = await comparePartyLedgers(prisma, t.org.id);
    assert.deepEqual(report.customers.map((row) => row.partyId), [c3.id], "the one party the old ledger has and no journal can explain");
    assert.equal(report.customers[0].oldNet, "25.00");
    assert.deepEqual(report.suppliers, []);
    // the repair is itself a posted journal with its own document: visible, one per customer, and the old sale journal got its document
    const moved = await prisma.journal.findFirstOrThrow({ where: { organizationId: t.org.id, docType: "LEGACY_ADVANCE" } });
    assert.equal(moved.docId, c2.id);
    assert.equal((await prisma.journal.findUniqueOrThrow({ where: { id: sale.id } })).docType, "SALE");
    assert.deepEqual((await partyLineViolations(prisma, t.org.id)).map((v) => v.problem), [], "every receivable and payable line has a party now");
  });
});

test("repairing twice changes nothing the second time", async () => {
  await withTestOrg(async (t) => {
    await legacyShop(t);
    await runTx((tx) => repairLegacyParties(tx, { organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id }));
    const journals = await prisma.journal.count({ where: { organizationId: t.org.id } });
    const second = await runTx((tx) => repairLegacyParties(tx, { organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id }));
    assert.deepEqual([second.linesStamped, second.advancesMoved], [0, 0]);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), journals);
  });
});

test("an opening balance the old code posted against Owner Capital is moved to Opening Balance Equity by a visible journal, once", async () => {
  await withTestOrg(async (t) => {
    await legacyShop(t);
    const net = async (role: string) => {
      const sums = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, account: { roles: { some: { role: role as never } } } }, _sum: { debit: true, credit: true } });
      return Number(sums._sum.credit ?? 0) - Number(sums._sum.debit ?? 0);
    };
    assert.equal(await net("CAPITAL"), 20, "Rahim's opening credited 50, Old Mill's opening debited 30");
    assert.equal(await net("OPENING_EQUITY"), 0);

    const first = await runTx((tx) => repairLegacyParties(tx, { organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id }));
    assert.equal(first.openingsReclassed, 2);
    assert.equal(await net("CAPITAL"), 0, "the owner put nothing in or took nothing out");
    assert.equal(await net("OPENING_EQUITY"), 20);
    const reclass = await prisma.journal.findMany({ where: { organizationId: t.org.id, docType: "OPENING_RECLASS" } });
    const openings = await prisma.journal.findMany({ where: { organizationId: t.org.id, docType: { in: ["CUSTOMER_OPENING", "SUPPLIER_OPENING"] } } });
    assert.deepEqual(reclass.map((row) => row.docId).sort(), openings.map((row) => row.id).sort(), "each move names the opening it moves");

    const second = await runTx((tx) => repairLegacyParties(tx, { organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id }));
    assert.equal(second.openingsReclassed, 0);
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id, docType: "OPENING_RECLASS" } }), 2);
  });
});
