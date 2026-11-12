import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";

// P02 task 1: the database shape of the ledger core (03_DATA_MODEL.md section 3). These tests talk to the tables
// directly on purpose: they prove what the database itself refuses, whatever the application code does.

const day = new Date("2026-10-01T00:00:00.000Z");

async function journalWithLine(t: { org: { id: string }; branch: { id: string } }, line: Record<string, unknown>, journal: Record<string, unknown> = {}) {
  const account = await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id } });
  return prisma.journal.create({
    data: {
      organizationId: t.org.id,
      branchId: t.branch.id,
      businessDate: day,
      status: "POSTED",
      ...journal,
      lines: { create: [{ organizationId: t.org.id, accountId: account.id, businessDate: day, branchId: t.branch.id, ...line }] },
    },
  });
}

test("an account can be a system account of a kind (cash, bank, mobile) with its bank details", async () => {
  await withTestOrg(async (t) => {
    const group = await prisma.accountGroup.findFirstOrThrow({ where: { organizationId: t.org.id, code: "1000" } });
    const row = await prisma.account.create({
      data: { organizationId: t.org.id, groupId: group.id, code: "1299", name: "Test bank", kind: "BANK", isSystem: false, accountNumber: "0123456789", bankName: "Test Bank Ltd", bankBranch: "Main" },
    });
    assert.deepEqual([row.kind, row.isSystem, row.accountNumber, row.bankName, row.bankBranch], ["BANK", false, "0123456789", "Test Bank Ltd", "Main"]);
    const plain = await prisma.account.create({ data: { organizationId: t.org.id, groupId: group.id, code: "1298", name: "Plain" } });
    assert.deepEqual([plain.kind, plain.isSystem, plain.accountNumber], ["OTHER", false, null], "the defaults");
  });
});

test("a role names one account, and one account may hold several roles but a role is used once per organization", async () => {
  await withTestOrg(async (t) => {
    const [a, b] = await prisma.account.findMany({ where: { organizationId: t.org.id }, take: 2, orderBy: { code: "asc" } });
    await prisma.accountRole.create({ data: { organizationId: t.org.id, role: "TEST_ROLE", accountId: a.id } });
    await prisma.accountRole.create({ data: { organizationId: t.org.id, role: "TEST_ROLE_2", accountId: a.id } });
    await assert.rejects(prisma.accountRole.create({ data: { organizationId: t.org.id, role: "TEST_ROLE", accountId: b.id } }), (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
  });
});

test("a document has one journal and its reversal is another: unique (docType, docId, kind)", async () => {
  await withTestOrg(async (t) => {
    const docId = randomUUID();
    await journalWithLine(t, { debit: "5.00" }, { docType: "SALE", docId, kind: "POSTING" });
    await assert.rejects(journalWithLine(t, { debit: "5.00" }, { docType: "SALE", docId, kind: "POSTING" }), (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
    const reversal = await journalWithLine(t, { credit: "5.00" }, { docType: "SALE", docId, kind: "REVERSAL" });
    assert.equal(reversal.kind, "REVERSAL");
    // journals that belong to no document (docType empty) are not limited
    await journalWithLine(t, { debit: "1.00" });
    await journalWithLine(t, { debit: "1.00" });
  });
});

test("a journal line carries its party, shift, branch, date and asset, and reads back as written", async () => {
  await withTestOrg(async (t) => {
    const partyId = randomUUID();
    const assetId = randomUUID();
    const journal = await journalWithLine(t, { debit: "12.50", partyType: "CUSTOMER", partyId, assetId });
    const line = await prisma.journalLine.findFirstOrThrow({ where: { journalId: journal.id } });
    assert.deepEqual([line.partyType, line.partyId, line.assetId, line.branchId, line.shiftId], ["CUSTOMER", partyId, assetId, t.branch.id, null]);
    assert.equal(line.businessDate.toISOString().slice(0, 10), "2026-10-01");
    for (const type of ["CUSTOMER", "VENDOR", "COURIER", "EMPLOYEE"] as const) {
      await journalWithLine(t, { debit: "1.00", partyType: type, partyId: randomUUID() });
    }
  });
});

test("the database itself refuses a line that is not exactly a debit or a credit above zero (I1)", async () => {
  await withTestOrg(async (t) => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ["debit and credit together", { debit: "5.00", credit: "5.00" }],
      ["both zero", { debit: "0.00", credit: "0.00" }],
      ["a negative debit", { debit: "-1.00" }],
      ["a negative credit", { credit: "-1.00" }],
    ];
    for (const [name, line] of bad) {
      await assert.rejects(journalWithLine(t, line), (error: unknown) => error instanceof Error, name);
    }
    await journalWithLine(t, { debit: "0.01" });
    await journalWithLine(t, { credit: "0.01" });
  });
});

test("the ledger tables have the indexes the reports and the party statements need", async () => {
  const indexes = await prisma.$queryRaw<{ name: string; columns: string }[]>`
    SELECT index_name AS name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'journal_lines'
    GROUP BY index_name`;
  const have = new Set(indexes.map((row) => row.columns));
  assert.equal(have.has("organizationId,accountId,businessDate"), true, "by account and date");
  assert.equal(have.has("organizationId,partyType,partyId,businessDate"), true, "by party and date");
  assert.equal(have.has("shiftId"), true, "by shift");
});

test("a payment is split over invoices or bills in payment_allocations, each row for exactly one of them", async () => {
  await withTestOrg(async (t) => {
    const journal = await journalWithLine(t, { debit: "30.00" });
    const sale = await prisma.sale.create({ data: { organizationId: t.org.id, branchId: t.branch.id, status: "POSTED", total: "30.00", businessDate: day } });
    const ok = await prisma.paymentAllocation.create({ data: { organizationId: t.org.id, journalId: journal.id, invoiceId: sale.id, amount: "30.00" } });
    assert.equal(ok.amount.toFixed(2), "30.00");
    await assert.rejects(prisma.paymentAllocation.create({ data: { organizationId: t.org.id, journalId: journal.id, amount: "1.00" } }), (e: unknown) => e instanceof Error, "neither an invoice nor a bill");
    const purchase = await prisma.purchase.create({ data: { organizationId: t.org.id, branchId: t.branch.id, supplierId: (await prisma.supplier.create({ data: { organizationId: t.org.id, name: "S" } })).id, status: "RECEIVED", total: "1.00", businessDate: day } });
    await assert.rejects(prisma.paymentAllocation.create({ data: { organizationId: t.org.id, journalId: journal.id, invoiceId: sale.id, billId: purchase.id, amount: "1.00" } }), (e: unknown) => e instanceof Error, "both");
    await assert.rejects(prisma.paymentAllocation.create({ data: { organizationId: t.org.id, journalId: journal.id, invoiceId: sale.id, amount: "0.00" } }), (e: unknown) => e instanceof Error, "an amount of zero");
  });
});
