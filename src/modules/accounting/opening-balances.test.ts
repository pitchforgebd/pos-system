import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { partyBalance } from "../../core/parties/index.ts";
import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { prisma } from "../../lib/db/client.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { createCustomer } from "../customers/customers.ts";
import { createSupplier } from "../purchasing/suppliers.ts";
import { createBankAccount, postOpeningCash } from "./books.ts";

// P02 task 8 (LV-2): what the business already had or owed when it started goes against Opening Balance Equity, not against
// the owner's capital: a customer's opening due (Dr receivable / Cr OBE), a vendor's (Dr OBE / Cr payable), cash and bank
// (Dr money / Cr OBE). The owner's capital then only moves when the owner puts money in or takes it out.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];

const who = (t: T) => ({ ip: "127.0.0.1", userAgent: "test", organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, idempotencyKey: randomUUID() });

async function balanceOf(t: T, role: string) {
  const mapping = await prisma.accountRole.findUniqueOrThrow({ where: { organizationId_role: { organizationId: t.org.id, role } } });
  const sums = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, accountId: mapping.accountId }, _sum: { debit: true, credit: true } });
  return Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0);
}

test("a customer's opening due is Dr receivable (the customer) / Cr Opening Balance Equity, and capital is untouched", async () => {
  await withTestOrg(async (t) => {
    const created = await createCustomer({ ...who(t), actorId: t.owner.id, name: "Old Debtor", openingBalance: "250.00" });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    const balance = await partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: created.customer.id });
    assert.equal(balance.toFixed(2), "250.00");
    assert.equal(await balanceOf(t, "OPENING_EQUITY"), -250);
    assert.equal(await balanceOf(t, "CAPITAL"), 0);
    const journal = await prisma.journal.findFirstOrThrow({ where: { organizationId: t.org.id, docType: "CUSTOMER_OPENING" } });
    assert.equal(journal.docId, created.customer.id);
    assert.equal(journal.businessDate.toISOString().slice(0, 10), (await import("../../core/time/business-date.ts")).businessDate());
    await assertBooksReconcile(t.org.id);
  });
});

test("a vendor's opening payable is Dr Opening Balance Equity / Cr payable (the vendor)", async () => {
  await withTestOrg(async (t) => {
    const created = await createSupplier({ ...who(t), actorId: t.owner.id, name: "Old Mill", openingPayable: "90.00" });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    const owed = await partyBalance(prisma, { organizationId: t.org.id, partyType: "VENDOR", partyId: created.supplier.id });
    assert.equal(owed.toFixed(2), "90.00");
    assert.equal(await balanceOf(t, "OPENING_EQUITY"), 90);
    assert.equal(await balanceOf(t, "CAPITAL"), 0);
    await assertBooksReconcile(t.org.id);
  });
});

test("an opening balance needs a branch to post to: without one the customer is not created at all, instead of a balance with no journal", async () => {
  await withTestOrg(async (t) => {
    const refused = await createCustomer({ ...who(t), actorId: t.owner.id, branchId: null, name: "No Branch", openingBalance: "40.00" });
    assert.equal(refused.ok, false);
    assert.equal(await prisma.customer.count({ where: { organizationId: t.org.id } }), 0);
    const supplier = await createSupplier({ ...who(t), actorId: t.owner.id, branchId: null, name: "No Branch Mill", openingPayable: "40.00" });
    assert.equal(supplier.ok, false);
    assert.equal(await prisma.supplier.count({ where: { organizationId: t.org.id } }), 0);
    // no opening, no branch needed
    assert.equal((await createCustomer({ ...who(t), actorId: t.owner.id, branchId: null, name: "Plain", openingBalance: "0.00" })).ok, true);
  });
});

test("a bank account's opening amount is Dr the bank / Cr Opening Balance Equity", async () => {
  await withTestOrg(async (t) => {
    const made = await createBankAccount({ ...who(t), name: "City Bank", openingAmount: "5000.00" });
    assert.equal(made.ok, true);
    const bank = await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, kind: "BANK", name: "City Bank" } });
    const sums = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id, accountId: bank.id }, _sum: { debit: true, credit: true } });
    assert.equal(Number(sums._sum.debit), 5000);
    assert.equal(await balanceOf(t, "OPENING_EQUITY"), -5000);
    assert.equal(await balanceOf(t, "CAPITAL"), 0);
  });
});

test("the cash on hand when the books start is Dr Cash in Hand / Cr Opening Balance Equity, once", async () => {
  await withTestOrg(async (t) => {
    const first = await postOpeningCash({ ...who(t), amount: "1200.00" });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(await balanceOf(t, "CASH"), 1200);
    assert.equal(await balanceOf(t, "OPENING_EQUITY"), -1200);
    const again = await postOpeningCash({ ...who(t), amount: "300.00" });
    assert.equal(again.ok, false, "the opening cash is entered once; later cash comes from sales, receipts and capital");
    assert.equal(await balanceOf(t, "CASH"), 1200);
    const bad = await postOpeningCash({ ...who(t), amount: "0.00" });
    assert.equal(bad.ok, false);
  });
});

test("openings together keep the books balanced: debits equal credits across the whole ledger", async () => {
  await withTestOrg(async (t) => {
    await createCustomer({ ...who(t), actorId: t.owner.id, name: "D", openingBalance: "100.00" });
    await createSupplier({ ...who(t), actorId: t.owner.id, name: "S", openingPayable: "60.00" });
    await createBankAccount({ ...who(t), name: "B", openingAmount: "500.00" });
    await postOpeningCash({ ...who(t), amount: "80.00" });
    const all = await prisma.journalLine.aggregate({ where: { organizationId: t.org.id }, _sum: { debit: true, credit: true } });
    assert.equal(Number(all._sum.debit), Number(all._sum.credit));
    assert.equal(await balanceOf(t, "OPENING_EQUITY"), -(100 + 500 + 80) + 60, "opening equity is what the business started with: assets less what it owed");
  });
});
