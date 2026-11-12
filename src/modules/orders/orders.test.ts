import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { invoicePayment } from "../../core/payments/index.ts";
import { assertBooksReconcile, reconcileBooks } from "../../core/reconcile/index.ts";
import { addDays, businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { postCustomerAdvance } from "../customers/advances.ts";
import { postInvoice } from "../sales/invoice.ts";
import { postSaleReturn } from "../sales/returns.ts";
import { concurrentlySettled, factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { cancelOrder, confirmOrder, createOrder, deliverOrder, dispatchOrder, getOrder, listOrders, orderBoard, packOrder, updateOrder, type OrderInput } from "./orders.ts";

// P06 tasks 3 and 4: DRAFT -> CONFIRMED (stock reserved) -> PACKED -> DISPATCHED (the invoice, the stock out) -> DELIVERED; CANCELLED before
// the dispatch releases the reservation; a quotation is a draft order with its own number.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T, key = randomUUID()) => ({ ...t.actor, idempotencyKey: key });
const reserved = async (t: T, productId: string) => (await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: t.org.id, productId } })).reservedQty.toFixed(4);
const onHand = async (t: T, productId: string) => (await prisma.stockBalance.findFirstOrThrow({ where: { organizationId: t.org.id, productId } })).quantity.toFixed(4);

async function draft(t: T, productId: string, customerId: string, quantity: string, extra: Partial<OrderInput> = {}, key?: string) {
  const made = await createOrder(actor(t, key), { customerId, businessDate: today(), lines: [{ productId, quantity }], ...extra });
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.ok ? made.id : "";
}

test("the life of an order: confirm reserves, pack, dispatch posts the invoice and the stock goes out, deliver; every step is an event", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const id = await draft(t, product.id, customer.id, "4", { channel: "FACEBOOK", externalRef: "FB-1001", chargesTotal: "5.00", deliveryMethod: "PICKUP" });
    assert.equal((await prisma.journal.count({ where: { organizationId: t.org.id, docType: "SALE" } })), 0, "a draft posts nothing");
    assert.equal(await reserved(t, product.id), "0.0000");

    const confirmed = await confirmOrder(actor(t), id);
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
    assert.ok(confirmed.ok && /^ORD-/.test(confirmed.number ?? ""));
    assert.deepEqual([await reserved(t, product.id), await onHand(t, product.id)], ["4.0000", "10.0000"], "held, not gone");
    // the reserved stock is not for anyone else: 10 on hand, 4 held, so a sale of 7 is refused and a sale of 6 is not
    const greedy = await postInvoice({ ...actor(t), businessDate: today(), customerId: customer.id, lines: [{ productId: product.id, quantity: "7" }] });
    assert.equal(greedy.ok, false);
    assert.match(!greedy.ok ? greedy.message : "", /reserved/i);

    assert.equal((await packOrder(actor(t), id)).ok, true);
    const sent = await dispatchOrder(actor(t), id, { dispatchedOn: today() });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.deepEqual([await reserved(t, product.id), await onHand(t, product.id)], ["0.0000", "6.0000"], "the reservation was consumed by the stock going out");
    const order = await getOrder(t.org.id, t.branch.id, id);
    assert.deepEqual([order?.status, order?.invoice?.number?.startsWith("INV-"), order?.total], ["DISPATCHED", true, "45.00"]);
    assert.equal((await prisma.stockReservation.findMany({ where: { orderId: id } })).every((r) => r.status === "CONSUMED"), true);
    const sale = await prisma.sale.findFirstOrThrow({ where: { orderId: id } });
    assert.equal((await invoicePayment(prisma, t.org.id, sale.id)).status, "UNPAID");
    assert.equal((await deliverOrder(actor(t), id)).ok, true);
    const events = (await getOrder(t.org.id, t.branch.id, id))?.events.map((e) => `${e.from ?? "-"}>${e.to}`);
    assert.deepEqual(events, ["->DRAFT", "DRAFT>CONFIRMED", "CONFIRMED>PACKED", "PACKED>DISPATCHED", "DISPATCHED>DELIVERED"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("two orders for the last unit: the second CONFIRM fails and nothing is held for it (also when both are confirmed at once)", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 1, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const [a, b] = [await draft(t, product.id, customer.id, "1"), await draft(t, product.id, customer.id, "1")];
    const results = await concurrentlySettled(2, (i) => confirmOrder(actor(t), i === 0 ? a : b));
    const ok = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    assert.equal(ok, 1, JSON.stringify(results.map((r) => (r.status === "fulfilled" ? r.value : String(r.reason)))));
    assert.equal(await reserved(t, product.id), "1.0000");
    assert.equal(await prisma.stockReservation.count({ where: { organizationId: t.org.id, status: "ACTIVE" } }), 1);
    const loser = (await prisma.salesOrder.findMany({ where: { organizationId: t.org.id } })).find((o) => o.status === "DRAFT");
    assert.ok(loser && loser.number === null, "the refused order is still a draft with no number");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("cancelling releases the reservation; after the dispatch a cancel is refused; a dispatch twice makes one invoice", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const a = await draft(t, product.id, customer.id, "3");
    assert.equal((await confirmOrder(actor(t), a)).ok, true);
    assert.equal(await reserved(t, product.id), "3.0000");
    const cancelled = await cancelOrder(actor(t), a, "customer changed their mind");
    assert.equal(cancelled.ok && cancelled.status, "CANCELLED");
    assert.deepEqual([await reserved(t, product.id), await onHand(t, product.id)], ["0.0000", "10.0000"]);
    assert.equal((await cancelOrder(actor(t), a)).ok, false, "cancelled twice");
    assert.equal((await confirmOrder(actor(t), a)).ok, false, "a cancelled order is not confirmed again");

    const b = await draft(t, product.id, customer.id, "2");
    assert.equal((await confirmOrder(actor(t), b)).ok, true);
    const both = await concurrentlySettled(2, () => dispatchOrder(actor(t), b, { dispatchedOn: today() }));
    assert.equal(both.filter((r) => r.status === "fulfilled" && r.value.ok).length, 1, JSON.stringify(both.map((r) => (r.status === "fulfilled" ? r.value : String(r.reason)))));
    assert.equal(await prisma.sale.count({ where: { organizationId: t.org.id, orderId: b } }), 1);
    const refused = await cancelOrder(actor(t), b);
    assert.equal(refused.ok, false);
    assert.equal(!refused.ok && refused.status, 422);
    assert.deepEqual([await reserved(t, product.id), await onHand(t, product.id)], ["0.0000", "8.0000"]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a draft can be changed and is priced again; only a draft", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const id = await draft(t, product.id, customer.id, "2");
    const changed = await updateOrder(actor(t), id, { customerId: customer.id, businessDate: today(), lines: [{ productId: product.id, quantity: "5" }], headerDiscount: "5.00" });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    const order = await getOrder(t.org.id, t.branch.id, id);
    assert.deepEqual([order?.total, order?.items.length, order?.items[0].quantity], ["45.00", 1, "5.0000"]);
    assert.equal((await confirmOrder(actor(t), id)).ok, true);
    assert.equal((await updateOrder(actor(t), id, { customerId: customer.id, businessDate: today(), lines: [{ productId: product.id, quantity: "1" }] })).ok, false);
  });
});

test("a quotation is a draft order with its own QUO number and a valid-until date; confirming it is the ordinary order path; an expired one cannot be confirmed", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const id = await draft(t, product.id, customer.id, "3", { isQuotation: true, validUntil: addDays(today(), 7) });
    const quote = await getOrder(t.org.id, t.branch.id, id);
    assert.deepEqual([quote?.isQuotation, quote?.status, /^QUO-/.test(quote?.quotationNumber ?? ""), quote?.number, quote?.validUntil], [true, "DRAFT", true, null, addDays(today(), 7)]);
    assert.deepEqual((await listOrders(t.org.id, t.branch.id, undefined, { quotations: true })).rows.map((r) => r.id), [id]);
    assert.equal((await listOrders(t.org.id, t.branch.id, undefined, { quotations: false })).rows.length, 0);
    const confirmed = await confirmOrder(actor(t), id);
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
    assert.equal(await reserved(t, product.id), "3.0000");
    const old = await draft(t, product.id, customer.id, "1", { isQuotation: true, validUntil: addDays(today(), -1) });
    const expired = await confirmOrder(actor(t), old);
    assert.equal(expired.ok, false);
    assert.match(!expired.ok ? expired.message : "", /expired/i);
  });
});

test("the order needs a named customer; the customer's advance pays at the dispatch; the board and the list filter; all goods returned makes it RETURNED", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 10, cost: "6.00", price: "10.00" });
    const customer = await factories(t).customer();
    const walkIn = await prisma.customer.create({ data: { organizationId: t.org.id, name: "Walk-in", isSystem: true } });
    const nobody = await createOrder(actor(t), { customerId: walkIn.id, businessDate: today(), lines: [{ productId: product.id, quantity: "1" }] });
    assert.equal(nobody.ok, false);

    assert.equal((await postCustomerAdvance({ ...actor(t), customerId: customer.id, businessDate: today(), amount: "100.00", method: "CASH" })).ok, true);
    const id = await draft(t, product.id, customer.id, "4", { channel: "WEBSITE" });
    await draft(t, product.id, customer.id, "1", { channel: "PHONE" });
    assert.equal((await confirmOrder(actor(t), id)).ok, true);
    const sent = await dispatchOrder(actor(t), id, { dispatchedOn: today(), tenders: [{ method: "WALLET", amount: "40.00" }] });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    const sale = await prisma.sale.findFirstOrThrow({ where: { orderId: id } });
    assert.equal((await invoicePayment(prisma, t.org.id, sale.id)).status, "PAID");

    const board = await orderBoard(t.org.id, t.branch.id);
    assert.deepEqual(board.map((c) => [c.status, c.count]), [["DRAFT", 1], ["CONFIRMED", 0], ["PACKED", 0], ["DISPATCHED", 1], ["DELIVERED", 0]]);
    assert.deepEqual((await listOrders(t.org.id, t.branch.id, undefined, { channel: "WEBSITE" })).rows.map((r) => r.id), [id]);
    assert.deepEqual((await listOrders(t.org.id, t.branch.id, undefined, { status: "DRAFT" })).rows.length, 1);
    assert.deepEqual((await listOrders(t.org.id, t.branch.id, undefined, { q: customer.name })).page.total, 2);

    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    const back = await postSaleReturn({ ...actor(t), saleId: sale.id, businessDate: today(), lines: [{ saleItemId: item.id, quantity: "4" }] });
    assert.equal(back.ok, true, JSON.stringify(back));
    assert.equal((await getOrder(t.org.id, t.branch.id, id))?.status, "RETURNED");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("I16: stock held for orders that no active reservation accounts for is a finding, and so is more held than is on hand", async () => {
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 5, cost: "6.00", price: "10.00" });
    assert.deepEqual((await reconcileBooks(prisma, t.org.id)).findings, []);
    await prisma.stockBalance.updateMany({ where: { organizationId: t.org.id, productId: product.id }, data: { reservedQty: "2" } });
    const found = (await reconcileBooks(prisma, t.org.id)).findings;
    assert.deepEqual(found.map((f) => f.invariant), ["I16"]);
    await prisma.stockBalance.updateMany({ where: { organizationId: t.org.id, productId: product.id }, data: { reservedQty: "0" } });
    assert.deepEqual((await reconcileBooks(prisma, t.org.id)).findings, []);
  });
});
