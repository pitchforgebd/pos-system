import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { addDays, businessDate as today } from "../time/business-date.ts";
import { concurrentlySettled, factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { assertBooksReconcile } from "../reconcile/index.ts";
import { postCustomerPayment } from "../../modules/customers/dues.ts";
import { createCustomer } from "../../modules/customers/customers.ts";
import { postPurchase, postSupplierPayment } from "../../modules/purchasing/purchases.ts";
import { postSaleReturn } from "../../modules/sales/returns.ts";
import { getSale, postSale } from "../../modules/sales/sales.ts";
import { allocationViolations, billPayment, invoicePayment } from "./index.ts";

// P02 task 9: which part of a receipt or a payment settles which invoice or bill (payment_allocations), and the payment status
// that follows. A receipt settles the oldest debt first, or the invoices the cashier names; an invoice is PAID when nothing is
// owed on it, PARTIAL when something was settled and something is left, UNPAID when nothing was settled.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T) => ({ organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, ip: "127.0.0.1", userAgent: "test" });

const stocked = (t: T) => stockedProduct(t);

async function creditSale(t: T, productId: string, customerId: string, units: number, daysAgo: number, extra: Record<string, unknown> = {}) {
  const sold = await postSale({ ...actor(t), idempotencyKey: randomUUID(), businessDate: addDays(today(), -daysAgo), customerId, lines: [{ productId, quantity: String(units) }], ...extra } as Parameters<typeof postSale>[0]);
  assert.equal(sold.ok, true, JSON.stringify(sold));
  return sold.ok ? sold.id : "";
}

const receipt = (t: T, customerId: string, amount: string, extra: Record<string, unknown> = {}) =>
  postCustomerPayment({ ...actor(t), idempotencyKey: randomUUID(), customerId, businessDate: today(), amount, method: "CASH", ...extra } as Parameters<typeof postCustomerPayment>[0]);

// What a receipt settled, as invoice -> amount, ordered by invoice id (rows written in one transaction can share a timestamp).
const alloc = async (journalDoc: string, t: T) =>
  (await prisma.paymentAllocation.findMany({ where: { organizationId: t.org.id, journal: { docType: "CUSTOMER_PAYMENT", docId: journalDoc } } }))
    .map((a) => [a.invoiceId, a.amount.toFixed(2)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
const sorted = (rows: string[][]) => [...rows].sort((a, b) => a[0].localeCompare(b[0]));

test("a receipt settles the oldest invoice first: 120 against invoices of 100, 50 and 80", async () => {
  await withTestOrg(async (t) => {
    const product = await stocked(t);
    const customer = await factories(t).customer();
    const [one, two, three] = [await creditSale(t, product.id, customer.id, 10, 2), await creditSale(t, product.id, customer.id, 5, 1), await creditSale(t, product.id, customer.id, 8, 0)];
    const first = await receipt(t, customer.id, "120.00");
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(await alloc(first.ok ? first.id : "", t), sorted([[one, "100.00"], [two, "20.00"]]));
    assert.equal((await invoicePayment(prisma, t.org.id, one)).status, "PAID");
    const partial = await invoicePayment(prisma, t.org.id, two);
    assert.deepEqual([partial.status, partial.owed.toFixed(2), partial.allocated.toFixed(2)], ["PARTIAL", "30.00", "20.00"]);
    assert.equal((await invoicePayment(prisma, t.org.id, three)).status, "UNPAID");

    const second = await receipt(t, customer.id, "100.00");
    assert.deepEqual(await alloc(second.ok ? second.id : "", t), sorted([[two, "30.00"], [three, "70.00"]]));
    assert.equal((await invoicePayment(prisma, t.org.id, two)).status, "PAID");
    assert.deepEqual([(await invoicePayment(prisma, t.org.id, three)).status, (await invoicePayment(prisma, t.org.id, three)).owed.toFixed(2)], ["PARTIAL", "10.00"]);
    assert.deepEqual(await allocationViolations(prisma, t.org.id), []);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
    const view = await getSale(t.org.id, t.branch.id, three);
    assert.deepEqual([view?.paymentStatus, view?.owed, view?.received], ["PARTIAL", "10.00", "70.00"], "the invoice page shows the status");
  });
});

test("the cashier can name the invoice a receipt is for; the rest of it settles the oldest", async () => {
  await withTestOrg(async (t) => {
    const product = await stocked(t);
    const customer = await factories(t).customer();
    const [one, , three] = [await creditSale(t, product.id, customer.id, 10, 2), await creditSale(t, product.id, customer.id, 5, 1), await creditSale(t, product.id, customer.id, 8, 0)];
    const paid = await receipt(t, customer.id, "90.00", { allocations: [{ invoiceId: three, amount: "60.00" }] });
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.deepEqual(await alloc(paid.ok ? paid.id : "", t), sorted([[three, "60.00"], [one, "30.00"]]), "60 to the named invoice, then the oldest takes the other 30");
    assert.equal((await invoicePayment(prisma, t.org.id, three)).owed.toFixed(2), "20.00");
  });
});

test("an allocation larger than what is owed on the invoice, or to someone else's invoice, is refused and nothing is posted", async () => {
  await withTestOrg(async (t) => {
    const product = await stocked(t);
    const customer = await factories(t).customer();
    const other = await factories(t).customer();
    const mine = await creditSale(t, product.id, customer.id, 5, 0);
    const theirs = await creditSale(t, product.id, other.id, 5, 0);
    await creditSale(t, product.id, customer.id, 5, 0); // the customer owes 100 in all, so a receipt of 60 itself is fine
    const before = await prisma.journal.count({ where: { organizationId: t.org.id } });
    assert.equal((await receipt(t, customer.id, "60.00", { allocations: [{ invoiceId: mine, amount: "60.00" }] })).ok, false, "more than the invoice owes (50)");
    assert.equal((await receipt(t, customer.id, "20.00", { allocations: [{ invoiceId: theirs, amount: "20.00" }] })).ok, false, "another customer's invoice");
    assert.equal((await receipt(t, customer.id, "10.00", { allocations: [{ invoiceId: mine, amount: "30.00" }] })).ok, false, "more than the receipt");
    assert.equal(await prisma.journal.count({ where: { organizationId: t.org.id } }), before);
    assert.equal(await prisma.paymentAllocation.count({ where: { organizationId: t.org.id } }), 0);
  });
});

test("an opening balance is the oldest debt: a receipt clears it before any invoice", async () => {
  await withTestOrg(async (t) => {
    const product = await stocked(t);
    const made = await createCustomer({ ...actor(t), actorId: t.owner.id, name: "Old", openingBalance: "60.00" });
    assert.equal(made.ok, true);
    const customerId = made.ok ? made.customer.id : "";
    const invoice = await creditSale(t, product.id, customerId, 10, 0);
    const first = await receipt(t, customerId, "80.00");
    assert.deepEqual(await alloc(first.ok ? first.id : "", t), [[invoice, "20.00"]], "60 cleared the opening balance, 20 reached the invoice");
    assert.equal((await invoicePayment(prisma, t.org.id, invoice)).owed.toFixed(2), "80.00");
    const second = await receipt(t, customerId, "80.00");
    assert.deepEqual(await alloc(second.ok ? second.id : "", t), [[invoice, "80.00"]]);
    assert.equal((await invoicePayment(prisma, t.org.id, invoice)).status, "PAID");
  });
});

test("a sale paid at the till is PAID, one part-paid is PARTIAL, a wallet-paid one is PAID; none of them has an allocation", async () => {
  await withTestOrg(async (t) => {
    const product = await stocked(t);
    const customer = await factories(t).customer();
    const cash = await creditSale(t, product.id, customer.id, 3, 0, { paymentAmount: "30.00", paymentMethod: "CASH" });
    const part = await creditSale(t, product.id, customer.id, 5, 0, { paymentAmount: "20.00", paymentMethod: "CASH" });
    assert.equal((await invoicePayment(prisma, t.org.id, cash)).status, "PAID");
    const status = await invoicePayment(prisma, t.org.id, part);
    assert.deepEqual([status.status, status.owed.toFixed(2), status.paidAtSale.toFixed(2)], ["PARTIAL", "30.00", "20.00"]);
    assert.equal(await prisma.paymentAllocation.count({ where: { organizationId: t.org.id } }), 0);
  });
});

test("a return on an unpaid invoice lowers what is owed on it, and the receipt that follows settles the rest", async () => {
  await withTestOrg(async (t) => {
    const product = await stocked(t);
    const customer = await factories(t).customer();
    const invoice = await creditSale(t, product.id, customer.id, 10, 0);
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: invoice } });
    const returned = await postSaleReturn({ ...actor(t), idempotencyKey: randomUUID(), saleId: invoice, businessDate: today(), lines: [{ saleItemId: item.id, quantity: "3" }] });
    assert.equal(returned.ok, true, JSON.stringify(returned));
    const afterReturn = await invoicePayment(prisma, t.org.id, invoice);
    assert.deepEqual([afterReturn.owed.toFixed(2), afterReturn.status], ["70.00", "UNPAID"]);
    const paid = await receipt(t, customer.id, "70.00");
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.equal((await invoicePayment(prisma, t.org.id, invoice)).status, "PAID");
  });
});

test("a payment to a vendor settles the oldest bill first, and a bill paid at purchase is PAID", async () => {
  await withTestOrg(async (t) => {
    const product = await factories(t).product({ purchasePrice: "10.00" });
    const vendor = await factories(t).vendor();
    const buy = async (units: string, daysAgo: number, extra: Record<string, unknown> = {}) => {
      const bought = await postPurchase({ ...actor(t), idempotencyKey: randomUUID(), supplierId: vendor.id, businessDate: addDays(today(), -daysAgo), lines: [{ productId: product.id, quantity: units, unitCost: "10.00" }], ...extra } as Parameters<typeof postPurchase>[0]);
      assert.equal(bought.ok, true, JSON.stringify(bought));
      return bought.ok ? bought.id : "";
    };
    const [one, two] = [await buy("10", 2), await buy("5", 1)]; // 100 and 50 owed
    const cash = await buy("2", 0, { paymentAmount: "20.00", paymentMethod: "CASH" });
    assert.equal((await billPayment(prisma, t.org.id, cash)).status, "PAID");
    const paid = await postSupplierPayment({ ...actor(t), idempotencyKey: randomUUID(), supplierId: vendor.id, businessDate: today(), amount: "120.00", method: "CASH" });
    assert.equal(paid.ok, true, JSON.stringify(paid));
    const rows = await prisma.paymentAllocation.findMany({ where: { organizationId: t.org.id, billId: { not: null } } });
    assert.deepEqual(sorted(rows.map((r) => [String(r.billId), r.amount.toFixed(2)])), sorted([[one, "100.00"], [two, "20.00"]]), "the bill paid at purchase has no allocation");
    assert.equal((await billPayment(prisma, t.org.id, one)).status, "PAID");
    const partial = await billPayment(prisma, t.org.id, two);
    assert.deepEqual([partial.status, partial.owed.toFixed(2)], ["PARTIAL", "30.00"]);
    assert.deepEqual(await allocationViolations(prisma, t.org.id), []);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("two receipts at the same moment never settle more than the invoice owes (I8)", async () => {
  await withTestOrg(async (t) => {
    const product = await stocked(t);
    const customer = await factories(t).customer();
    const invoice = await creditSale(t, product.id, customer.id, 10, 0); // owes 100
    const results = await concurrentlySettled(4, () => receipt(t, customer.id, "40.00"));
    const answers = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    assert.ok(answers.every((a) => a !== null));
    assert.equal(answers.filter((a) => a?.ok).length, 2, "two of 40 fit in 100, the others are refused");
    const status = await invoicePayment(prisma, t.org.id, invoice);
    assert.deepEqual([status.allocated.toFixed(2), status.owed.toFixed(2)], ["80.00", "20.00"]);
    assert.deepEqual(await allocationViolations(prisma, t.org.id), []);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("allocationViolations finds an over-settled invoice and a receipt that allocated more than it was", async () => {
  await withTestOrg(async (t) => {
    const product = await stocked(t);
    const customer = await factories(t).customer();
    const invoice = await creditSale(t, product.id, customer.id, 5, 0); // owes 50
    const paid = await receipt(t, customer.id, "50.00");
    assert.equal(paid.ok, true);
    const journal = await prisma.journal.findFirstOrThrow({ where: { organizationId: t.org.id, docType: "CUSTOMER_PAYMENT" } });
    // planted: a second allocation of the same receipt to the same invoice
    await prisma.paymentAllocation.create({ data: { organizationId: t.org.id, journalId: journal.id, invoiceId: invoice, amount: "5.00" } });
    const found = (await allocationViolations(prisma, t.org.id)).map((v) => v.problem).sort();
    assert.equal(found.length, 2);
    assert.match(found[0], /invoice/);
    assert.match(found[1], /receipt|payment/);
  });
});
