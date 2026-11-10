import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { postCustomerPayment } from "../../modules/customers/dues.ts";
import { postPurchase } from "../../modules/purchasing/purchases.ts";
import { postSaleReturn } from "../../modules/sales/returns.ts";
import { postSale } from "../../modules/sales/sales.ts";
import { factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { businessDate as today } from "../time/business-date.ts";
import { assertBooksReconcile, BooksReconcileError, reconcileBooks } from "./index.ts";

// P02 task 10. assertBooksReconcile(orgId) is the check every integration test ends with and the daily job runs: it names what is
// wrong (the account, product or party, and by how much) instead of saying "off by something".

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T) => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, ip: "127.0.0.1", userAgent: "test" });

/** Some real postings: a purchase, a credit sale, a return on it and a receipt. */
async function trade(t: T) {
  const product = await stockedProduct(t);
  const customer = await factories(t).customer();
  const vendor = await factories(t).vendor();
  const bought = await postPurchase({ ...actor(t), idempotencyKey: randomUUID(), supplierId: vendor.id, businessDate: today(), lines: [{ productId: product.id, quantity: "20", unitCost: "6.00" }], paymentAmount: "50.00", paymentMethod: "CASH" });
  assert.equal(bought.ok, true, JSON.stringify(bought));
  const sold = await postSale({ ...actor(t), idempotencyKey: randomUUID(), businessDate: today(), customerId: customer.id, lines: [{ productId: product.id, quantity: "10" }], paymentAmount: "30.00", paymentMethod: "CASH" });
  assert.equal(sold.ok, true, JSON.stringify(sold));
  const saleId = sold.ok ? sold.id : "";
  const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId } });
  const returned = await postSaleReturn({ ...actor(t), idempotencyKey: randomUUID(), saleId, businessDate: today(), lines: [{ saleItemId: item.id, quantity: "2" }] });
  assert.equal(returned.ok, true, JSON.stringify(returned));
  const paid = await postCustomerPayment({ ...actor(t), idempotencyKey: randomUUID(), customerId: customer.id, businessDate: today(), amount: "20.00", method: "CASH" });
  assert.equal(paid.ok, true, JSON.stringify(paid));
  return { product, customer, vendor, saleId };
}

const roleAccount = async (t: T, role: string) => (await prisma.accountRole.findFirstOrThrow({ where: { organizationId: t.org.id, role: role as never } })).accountId;

async function plantJournal(t: T, lines: Array<{ role: string; debit: string; credit: string; party?: { type: "CUSTOMER"; id: string } }>) {
  const journal = await prisma.journal.create({ data: { organizationId: t.org.id, branchId: t.branch.id, businessDate: new Date(`${today()}T00:00:00.000Z`), status: "POSTED", description: "planted", createdById: t.owner.id } });
  for (const line of lines) {
    await prisma.journalLine.create({
      data: {
        organizationId: t.org.id,
        journalId: journal.id,
        accountId: await roleAccount(t, line.role),
        debit: line.debit,
        credit: line.credit,
        branchId: t.branch.id,
        businessDate: new Date(`${today()}T00:00:00.000Z`),
        partyType: line.party?.type,
        partyId: line.party?.id,
      },
    });
  }
  return journal;
}

const invariants = (found: Array<{ invariant: string }>) => [...new Set(found.map((f) => f.invariant))].sort();

test("books made by real postings reconcile: no finding, no warning", async () => {
  await withTestOrg(async (t) => {
    await trade(t);
    const result = await reconcileBooks(prisma, t.org.id);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.warnings, []);
    await assertBooksReconcile(t.org.id);
  });
});

test("a journal that does not balance is named (I1) and breaks the trial balance (I15)", async () => {
  await withTestOrg(async (t) => {
    await trade(t);
    const journal = await plantJournal(t, [{ role: "CASH", debit: "10.00", credit: "0.00" }]);
    const result = await reconcileBooks(prisma, t.org.id);
    assert.deepEqual(invariants(result.findings), ["I1", "I15"]);
    const i1 = result.findings.find((f) => f.invariant === "I1");
    assert.match(i1?.subject ?? "", new RegExp(journal.id));
    assert.match(i1?.message ?? "", /10\.00/);
    await assert.rejects(assertBooksReconcile(t.org.id), (error: unknown) => error instanceof BooksReconcileError && /I1/.test(error.message) && error.findings.length === 2);
  });
});

test("the database refuses a line with a debit and a credit, so the I1 line check is a second guard", async () => {
  await withTestOrg(async (t) => {
    const journal = await prisma.journal.create({ data: { organizationId: t.org.id, branchId: t.branch.id, businessDate: new Date(`${today()}T00:00:00.000Z`), status: "POSTED", createdById: t.owner.id } });
    // the CHECK on journal_lines stops it at the door; the reconcile query finds one that got in with the constraint off
    await assert.rejects(
      prisma.journalLine.create({ data: { organizationId: t.org.id, journalId: journal.id, accountId: await roleAccount(t, "CASH"), debit: "5.00", credit: "5.00", businessDate: new Date(`${today()}T00:00:00.000Z`) } }),
    );
  });
});

test("stock that disagrees with its movements is named by product and quantity (I4), and the inventory account warns (I6)", async () => {
  await withTestOrg(async (t) => {
    const { product } = await trade(t);
    await prisma.stockBalance.updateMany({ where: { organizationId: t.org.id, productId: product.id }, data: { quantity: { increment: "5.0000" } } });
    const result = await reconcileBooks(prisma, t.org.id);
    assert.deepEqual(invariants(result.findings), ["I4"]);
    assert.match(result.findings[0].subject, new RegExp(product.sku));
    assert.match(result.findings[0].message, /5\.0000/);
    assert.deepEqual(invariants(result.warnings), ["I6"], "5 units at 6.00 = 30.00 more stock than the inventory account holds");
    assert.match(result.warnings[0].message, /30\.00/);
    await assert.rejects(assertBooksReconcile(t.org.id), BooksReconcileError);
  });
});

test("a warning alone does not fail the check", async () => {
  await withTestOrg(async (t) => {
    const { product } = await trade(t);
    await prisma.stockBalance.updateMany({ where: { organizationId: t.org.id, productId: product.id }, data: { averageCost: "9.00" } });
    const result = await reconcileBooks(prisma, t.org.id);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(invariants(result.warnings), ["I6"]);
    await assertBooksReconcile(t.org.id);
    await assert.rejects(assertBooksReconcile(t.org.id, prisma, { strictInventory: true }), BooksReconcileError);
  });
});

test("more expiry-lot quantity than stock is named (I7)", async () => {
  await withTestOrg(async (t) => {
    const { product } = await trade(t);
    await prisma.expiryBatch.create({ data: { organizationId: t.org.id, branchId: t.branch.id, warehouseId: t.warehouse.id, productId: product.id, lot: "L1", expiresOn: new Date("2030-01-01T00:00:00.000Z"), quantity: "5000.0000" } });
    const result = await reconcileBooks(prisma, t.org.id);
    assert.deepEqual(invariants(result.findings), ["I7"]);
    assert.match(result.findings[0].subject, new RegExp(product.sku));
  });
});

test("a receivable line with no party is named (I2); an over-settled invoice is named (I8)", async () => {
  await withTestOrg(async (t) => {
    const { customer, saleId } = await trade(t);
    await plantJournal(t, [
      { role: "AR", debit: "5.00", credit: "0.00" },
      { role: "SALES", debit: "0.00", credit: "5.00" },
    ]);
    const payment = await prisma.journal.findFirstOrThrow({ where: { organizationId: t.org.id, docType: "CUSTOMER_PAYMENT" } });
    await prisma.paymentAllocation.create({ data: { organizationId: t.org.id, journalId: payment.id, invoiceId: saleId, amount: "500.00" } });
    const result = await reconcileBooks(prisma, t.org.id);
    assert.deepEqual(invariants(result.findings), ["I2", "I8"]);
    assert.ok(result.findings.some((f) => f.invariant === "I8" && f.subject.includes(saleId)));
    assert.ok(customer.id);
  });
});

test("an organization with nothing posted reconciles", async () => {
  await withTestOrg(async (t) => {
    await assertBooksReconcile(t.org.id);
  });
});
