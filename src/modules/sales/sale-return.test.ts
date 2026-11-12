import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { partyBalance } from "../../core/parties/index.ts";
import { invoicePayment } from "../../core/payments/index.ts";
import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { addDays, businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { createBankAccount } from "../accounting/books.ts";
import { postOpeningStock } from "../inventory/documents.ts";
import { factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { postInvoice, type InvoiceInput } from "./invoice.ts";
import { postSaleReturn, type RefundMethod } from "./returns.ts";

// P06 task 7 (C3, N12, N25, N26): a return gives back the sale's own lines in proportion (two instalments add up to the original), the
// stock into the lots it came from, and the money the way the customer paid (the default), to their advance, or as credit on their account.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T) => ({ ...t.actor, idempotencyKey: randomUUID() });
const sell = (t: T, input: Partial<InvoiceInput> & Pick<InvoiceInput, "lines">) => postInvoice({ ...actor(t), businessDate: today(), ...input });
async function returnOf(t: T, saleId: string, quantity: string, extra: { refundMethod?: RefundMethod; refundAccountId?: string; businessDate?: string } = {}) {
  const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId } });
  return postSaleReturn({ ...actor(t), saleId, businessDate: extra.businessDate ?? today(), refundMethod: extra.refundMethod, refundAccountId: extra.refundAccountId, lines: [{ saleItemId: item.id, quantity }] });
}

const lines = async (t: T, returnId: string) =>
  (await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "SALE_RETURN", docId: returnId } }, include: { account: { include: { roles: true } } } }))
    .map((l) => `${l.account.roles[0]?.role ?? l.account.name}:${l.debit.toFixed(2)}/${l.credit.toFixed(2)}`)
    .sort();

test("a sale with VAT and a discount, returned in two instalments: the instalments add up to the original, VAT and sales each reversed by their own share", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 20, cost: "60.00", price: "100.00", product: { vatType: "EXCLUSIVE", vatValue: "10" } });
    const done = await sell(t, { lines: [{ productId: product.id, quantity: "3", discountAmount: "30.00" }], tenders: [{ method: "CASH", amount: "297.00" }] });
    assert.equal(done.ok, true, JSON.stringify(done));
    const id = done.ok ? done.id : "";
    // 3 x 100 = 300, less 30 = 270, VAT 10% = 27: the customer paid 297.00
    const one = await returnOf(t, id, "1");
    assert.equal(one.ok, true, JSON.stringify(one));
    assert.deepEqual(await lines(t, one.ok ? one.id : ""), ["CASH:0.00/99.00", "COGS:0.00/60.00", "INVENTORY:60.00/0.00", "OUTPUT_VAT:9.00/0.00", "SALES:90.00/0.00"]);
    const two = await returnOf(t, id, "2");
    assert.equal(two.ok, true, JSON.stringify(two));
    assert.deepEqual(await lines(t, two.ok ? two.id : ""), ["CASH:0.00/198.00", "COGS:0.00/120.00", "INVENTORY:120.00/0.00", "OUTPUT_VAT:18.00/0.00", "SALES:180.00/0.00"]);
    const total = await prisma.saleReturn.aggregate({ where: { organizationId: t.org.id }, _sum: { total: true } });
    assert.equal(total._sum.total?.toFixed(2), "297.00", "the two returns add up to what was sold");
    assert.equal((await returnOf(t, id, "1")).ok, false, "nothing is left to return");
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { productId: product.id } })).quantity.toFixed(4), "20.0000");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the refund goes back the way the customer paid: bKash out of the same wallet; an unpaid invoice is cancelled without any refund", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 20, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const made = await createBankAccount({ ip: "127.0.0.1", userAgent: "test", organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, idempotencyKey: randomUUID(), name: "bKash", kind: "MOBILE", accountNumber: "01711-000000" });
    assert.equal(made.ok, true);
    const bkash = await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name: "bKash" } });
    const paid = await sell(t, { customerId: customer.id, lines: [{ productId: product.id, quantity: "4" }], tenders: [{ method: "MOBILE", accountId: bkash.id, amount: "40.00" }] });
    assert.ok(paid.ok);
    const back = await returnOf(t, paid.ok ? paid.id : "", "2");
    assert.equal(back.ok, true, JSON.stringify(back));
    assert.ok((await lines(t, back.ok ? back.id : "")).includes("bKash:0.00/20.00"), "refunded out of the wallet it came in by");
    const row = await prisma.saleReturn.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.deepEqual([row.refundMethod, row.refundAccountId], ["MOBILE", bkash.id]);

    const unpaid = await sell(t, { customerId: customer.id, lines: [{ productId: product.id, quantity: "5" }] });
    assert.ok(unpaid.ok);
    const cancelled = await returnOf(t, unpaid.ok ? unpaid.id : "", "2");
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
    assert.ok((await lines(t, cancelled.ok ? cancelled.id : "")).includes("AR:0.00/20.00"), "what is owed goes down, no money moves");
    assert.deepEqual([(await invoicePayment(prisma, t.org.id, unpaid.ok ? unpaid.id : "")).owed.toFixed(2), await partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customer.id }).then((v) => v.toFixed(2))], ["30.00", "30.00"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the refund can go to the customer's advance or stay as credit on their account; a Walk-in sale is refunded in cash; the return cannot be older than the sale", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 20, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const sale = async (customerId?: string) => {
      const done = await sell(t, { customerId, lines: [{ productId: product.id, quantity: "4" }], tenders: [{ method: "CASH", amount: "40.00" }] });
      assert.ok(done.ok);
      return done.ok ? done.id : "";
    };
    const toAdvance = await returnOf(t, await sale(customer.id), "1", { refundMethod: "ADVANCE" });
    assert.equal(toAdvance.ok, true, JSON.stringify(toAdvance));
    assert.equal((await partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customer.id, account: "ADVANCE" })).toFixed(2), "10.00");
    const asCredit = await returnOf(t, await sale(customer.id), "1", { refundMethod: "AR_ONLY" });
    assert.equal(asCredit.ok, true, JSON.stringify(asCredit));
    assert.equal((await partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customer.id })).toFixed(2), "-10.00", "the shop owes the customer 10.00 on their account");
    const walkIn = await sale();
    const refused = await returnOf(t, walkIn, "1", { refundMethod: "ADVANCE" });
    assert.equal(refused.ok, false);
    assert.equal((await returnOf(t, walkIn, "1")).ok, true, "cash back to a Walk-in");
    const older = await returnOf(t, walkIn, "1", { businessDate: addDays(today(), -5) });
    assert.equal(older.ok, false);
    assert.match(!older.ok ? older.message : "", /before the sale/i);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("an expiry-tracked product comes back into the lots the sale took it from", async () => {
  await withTestOrg(async (t) => {
    const milk = await factories(t).product({ name: "Milk", sku: "MILK", slug: "milk", trackExpiry: true, sellingPrice: "10.00", purchasePrice: "6.00", wholesalePrice: "9.00", minimumPrice: "5.00" });
    const soon = addDays(today(), 20);
    const later = addDays(today(), 90);
    const stocked = await postOpeningStock({
      ...t.actor,
      idempotencyKey: randomUUID(),
      businessDate: today(),
      lines: [{ productId: milk.id, quantity: "5", unitCost: "6.00", lot: "SOON", expiresOn: soon }, { productId: milk.id, quantity: "10", unitCost: "6.00", lot: "LATER", expiresOn: later }],
    } as Parameters<typeof postOpeningStock>[0]);
    assert.equal(stocked.ok, true, JSON.stringify(stocked));
    const done = await sell(t, { lines: [{ productId: milk.id, quantity: "7" }], tenders: [{ method: "CASH", amount: "70.00" }] });
    assert.equal(done.ok, true, JSON.stringify(done));
    const quantities = async () => Object.fromEntries((await prisma.expiryBatch.findMany({ where: { organizationId: t.org.id, productId: milk.id } })).map((b) => [b.lot, b.quantity.toFixed(0)]));
    assert.deepEqual(await quantities(), { SOON: "0", LATER: "8" }, "the earliest expiry goes first");
    const first = await returnOf(t, done.ok ? done.id : "", "6");
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(await quantities(), { SOON: "5", LATER: "9" }, "5 back to the lot it came from, the sixth to the next");
    const second = await returnOf(t, done.ok ? done.id : "", "1");
    assert.equal(second.ok, true);
    assert.deepEqual(await quantities(), { SOON: "5", LATER: "10" });
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
