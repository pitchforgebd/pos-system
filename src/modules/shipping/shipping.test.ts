import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { partyBalance } from "../../core/parties/index.ts";
import { invoicePayment } from "../../core/payments/index.ts";
import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { addDays, businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { postCustomerAdvance } from "../customers/advances.ts";
import { confirmOrder, createOrder, deliverOrder, dispatchOrder, getOrder } from "../orders/orders.ts";
import { concurrentlySettled, factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";
import { courierDues, settleCourier, unsettledParcels } from "./settlements.ts";
import { createShipmentInTx, getShipment, listShipments, moveShipment, returnShipment, type ShipmentInput } from "./shipments.ts";

// P07: a parcel by courier is handed over with the customer's cash to collect (#24), the delivery charge (#25) and the condition charge (#26)
// post with it; the courier settles (#27); a parcel that comes back gives the receivable back (#28) and the sale is returned in full.

type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];
const actor = (t: T, key = randomUUID()) => ({ ...t.actor, idempotencyKey: key });
const owner = { canApproveDifference: true };
void createShipmentInTx;

async function setup(t: T, options: { units?: number } = {}) {
  const f = factories(t);
  const product = await stockedProduct(t, { units: options.units ?? 50, cost: "60.00", price: "100.00" });
  const customer = await f.customer({ name: "Rina Traders", address: "Mirpur, Dhaka" });
  const courier = await prisma.courier.create({ data: { organizationId: t.org.id, name: "Steadfast", defaultConditionPercent: "1", defaultDeliveryCharge: "60", outsideDeliveryCharge: "110" } });
  return { product, customer, courier };
}

async function parcel(t: T, s: Awaited<ReturnType<typeof setup>>, quantity: string, shipment: ShipmentInput = {}, extra: { tenders?: Array<{ method: "WALLET"; amount: string }>; key?: string } = {}) {
  const made = await createOrder(actor(t), { customerId: s.customer.id, businessDate: today(), deliveryMethod: "COURIER", shippingAddress: "House 4, Mirpur", lines: [{ productId: s.product.id, quantity }] });
  assert.equal(made.ok, true, JSON.stringify(made));
  const id = made.ok ? made.id : "";
  assert.equal((await confirmOrder(actor(t), id)).ok, true);
  const sent = await dispatchOrder(actor(t, extra.key), id, { dispatchedOn: today(), tenders: extra.tenders, shipment: { courierId: s.courier.id, ...shipment } });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  const row = await prisma.shipment.findFirstOrThrow({ where: { orderId: id } });
  return { orderId: id, shipmentId: row.id, saleId: row.saleId as string };
}

const courierBalance = async (t: T, courierId: string) => (await partyBalance(prisma, { organizationId: t.org.id, partyType: "COURIER", partyId: courierId })).toFixed(2);
const customerBalance = async (t: T, customerId: string) => (await partyBalance(prisma, { organizationId: t.org.id, partyType: "CUSTOMER", partyId: customerId })).toFixed(2);
const roleTotal = async (t: T, role: string) => {
  const lines = await prisma.journalLine.findMany({ where: { organizationId: t.org.id, account: { roles: { some: { role: role as never } } } }, select: { debit: true, credit: true } });
  return lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0).toFixed(2);
};
const deliver = async (t: T, id: string) => {
  for (const to of ["PICKED", "IN_TRANSIT", "DELIVERED"] as const) {
    const done = await moveShipment(actor(t), id, to);
    assert.equal(done.ok, true, JSON.stringify(done));
  }
};

test("COD 1000, delivery 60, condition 1%: the handover posts the three together, the settlement brings 930, the courier's account is clear, 6700 = 60, 6710 = 10", async () => {
  await withTestOrg(async (t) => {
    const s = await setup(t);
    const p = await parcel(t, s, "10", { trackingCode: "SF-1001" });
    const shipment = await getShipment(t.org.id, t.branch.id, p.shipmentId);
    assert.deepEqual([shipment?.number?.startsWith("SHP-"), shipment?.codAmount, shipment?.deliveryCharge, shipment?.conditionCharge, shipment?.expectedNet], [true, "1000.00", "60.00", "10.00", "930.00"]);
    const lines = (await prisma.journalLine.findMany({ where: { organizationId: t.org.id, journal: { docType: "SHIPMENT", docId: p.shipmentId } }, include: { account: { include: { roles: true } } } }))
      .map((l) => `${l.account.roles[0]?.role}:${l.debit.toFixed(2)}/${l.credit.toFixed(2)}`)
      .sort();
    assert.deepEqual(lines, ["AR:0.00/1000.00", "COD_CHARGE:10.00/0.00", "COURIER_AR:0.00/10.00", "COURIER_AR:0.00/60.00", "COURIER_AR:1000.00/0.00", "TRANSPORT:60.00/0.00"]);
    assert.deepEqual([await courierBalance(t, s.courier.id), await customerBalance(t, s.customer.id)], ["930.00", "0.00"], "the courier owes 930, the customer owes nothing");
    assert.equal((await invoicePayment(prisma, t.org.id, p.saleId)).status, "PAID", "the handover settles the invoice");
    assert.equal((await getOrder(t.org.id, t.branch.id, p.orderId))?.status, "DISPATCHED");

    await deliver(t, p.shipmentId);
    assert.equal((await getOrder(t.org.id, t.branch.id, p.orderId))?.status, "DELIVERED", "the order is delivered with its parcel");
    const waiting = await unsettledParcels(t.org.id, t.branch.id, s.courier.id);
    assert.deepEqual(waiting.map((w) => [w.cod, w.delivery, w.condition, w.amount]), [["1000.00", "60.00", "10.00", "930.00"]]);

    const settled = await settleCourier(actor(t), { courierId: s.courier.id, shipmentIds: [p.shipmentId], businessDate: today(), netReceived: "930.00" });
    assert.equal(settled.ok, true, JSON.stringify(settled));
    assert.equal(await courierBalance(t, s.courier.id), "0.00", "account 1350 is empty");
    assert.deepEqual([await roleTotal(t, "TRANSPORT"), await roleTotal(t, "COD_CHARGE"), await roleTotal(t, "CASH")], ["60.00", "10.00", "930.00"]);
    const row = await prisma.courierSettlement.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.deepEqual([row.grossCod.toFixed(2), row.deliveryCharges.toFixed(2), row.conditionCharges.toFixed(2), row.netReceived.toFixed(2), row.difference.toFixed(2), /^SET-/.test(row.number ?? "")], ["1000.00", "60.00", "10.00", "930.00", "0.00", true]);
    assert.deepEqual(await unsettledParcels(t.org.id, t.branch.id, s.courier.id), []);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a parcel that comes back: the courier gives the cash back, the customer's receivable is nothing, the stock is back, the revenue is reversed, the way back is 6700", async () => {
  await withTestOrg(async (t) => {
    const s = await setup(t);
    const p = await parcel(t, s, "10");
    assert.equal(await courierBalance(t, s.courier.id), "930.00");
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { productId: s.product.id } })).quantity.toFixed(4), "40.0000");
    const back = await returnShipment(actor(t), p.shipmentId, { businessDate: today(), returnCharge: "30.00", reason: "Customer not at home" });
    assert.equal(back.ok, true, JSON.stringify(back));
    assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { productId: s.product.id } })).quantity.toFixed(4), "50.0000", "the stock is back");
    assert.equal(await customerBalance(t, s.customer.id), "0.00", "the receivable is nothing");
    assert.equal(await roleTotal(t, "SALES"), "0.00", "the revenue is reversed");
    assert.equal(await courierBalance(t, s.courier.id), "-90.00", "the shop owes the courier its 60 for delivering and 30 for the way back; the condition charge is reversed");
    assert.deepEqual([await roleTotal(t, "TRANSPORT"), await roleTotal(t, "COD_CHARGE")], ["90.00", "0.00"]);
    assert.equal((await prisma.paymentAllocation.count({ where: { organizationId: t.org.id, invoiceId: p.saleId } })), 0);
    const row = await getShipment(t.org.id, t.branch.id, p.shipmentId);
    assert.deepEqual([row?.status, row?.returnedOn, row?.events.map((e) => e.status)], ["RETURNED", today(), ["CREATED", "RETURNED"]]);
    assert.equal((await getOrder(t.org.id, t.branch.id, p.orderId))?.status, "RETURNED");
    assert.equal((await returnShipment(actor(t), p.shipmentId, { businessDate: today() })).ok, false, "only once");

    // the next settlement takes what is owed for the parcel that came back off what a delivered one brings
    const next = await parcel(t, s, "10");
    await deliver(t, next.shipmentId);
    const waiting = await unsettledParcels(t.org.id, t.branch.id, s.courier.id);
    assert.deepEqual(waiting.map((w) => [w.status, w.amount]).sort(), [["DELIVERED", "930.00"], ["RETURNED", "-90.00"]]);
    const settled = await settleCourier(actor(t), { courierId: s.courier.id, shipmentIds: waiting.map((w) => w.id), businessDate: today(), netReceived: "840.00" });
    assert.equal(settled.ok, true, JSON.stringify(settled));
    assert.equal(await courierBalance(t, s.courier.id), "0.00");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a parcel is in one settlement only; only delivered parcels and returned ones are settled; two at once make one", async () => {
  await withTestOrg(async (t) => {
    const s = await setup(t);
    const p = await parcel(t, s, "10");
    const early = await settleCourier(actor(t), { courierId: s.courier.id, shipmentIds: [p.shipmentId], businessDate: today(), netReceived: "930.00" });
    assert.equal(early.ok, false, "not delivered yet");
    await deliver(t, p.shipmentId);
    const results = await concurrentlySettled(2, () => settleCourier(actor(t), { courierId: s.courier.id, shipmentIds: [p.shipmentId], businessDate: today(), netReceived: "930.00" }));
    assert.equal(results.filter((r) => r.status === "fulfilled" && r.value.ok).length, 1, JSON.stringify(results.map((r) => (r.status === "fulfilled" ? r.value : String(r.reason)))));
    const again = await settleCourier(actor(t), { courierId: s.courier.id, shipmentIds: [p.shipmentId], businessDate: today(), netReceived: "930.00" });
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.status, 409);
    assert.equal(await prisma.courierSettlement.count({ where: { organizationId: t.org.id } }), 1);
    assert.equal(await courierBalance(t, s.courier.id), "0.00");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("what came is not what should have: a reason and the owner's approval; a shortage is the condition charge, an excess is other income; the courier's account is clear either way", async () => {
  await withTestOrg(async (t) => {
    const s = await setup(t);
    const a = await parcel(t, s, "10");
    const b = await parcel(t, s, "10");
    await deliver(t, a.shipmentId);
    await deliver(t, b.shipmentId);
    const base = { courierId: s.courier.id, shipmentIds: [a.shipmentId], businessDate: today(), netReceived: "900.00" };
    assert.equal((await settleCourier(actor(t), base)).ok, false, "no reason");
    assert.equal((await settleCourier(actor(t), { ...base, differenceReason: "The courier kept 30 for packing" })).ok, false, "no approval");
    const short = await settleCourier(actor(t), { ...base, differenceReason: "The courier kept 30 for packing", ...owner });
    assert.equal(short.ok, true, JSON.stringify(short));
    assert.equal(await courierBalance(t, s.courier.id), "930.00", "the second parcel is still owed");
    const over = await settleCourier(actor(t), { courierId: s.courier.id, shipmentIds: [b.shipmentId], businessDate: today(), netReceived: "950.00", differenceReason: "A customer's tip, paid through", ...owner });
    assert.equal(over.ok, true, JSON.stringify(over));
    assert.equal(await courierBalance(t, s.courier.id), "0.00");
    assert.deepEqual([await roleTotal(t, "COD_CHARGE"), await roleTotal(t, "OTHER_INCOME")], ["50.00", "-20.00"], "10+10 condition, 30 short; 20 over");
    const rows = await prisma.courierSettlement.findMany({ where: { organizationId: t.org.id }, orderBy: { difference: "asc" } });
    assert.deepEqual(rows.map((r) => [r.difference.toFixed(2), r.differenceReason !== null, r.approvedById === t.owner.id]), [["-30.00", true, true], ["20.00", true, true]]);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("by the shop's own vehicle: the fare is an expense out of the till; the order is delivered with it", async () => {
  await withTestOrg(async (t) => {
    const s = await setup(t);
    const made = await createOrder(actor(t), { customerId: s.customer.id, businessDate: today(), deliveryMethod: "OWN_VEHICLE", shippingAddress: "Uttara", lines: [{ productId: s.product.id, quantity: "2" }] });
    assert.ok(made.ok);
    const id = made.ok ? made.id : "";
    assert.equal((await confirmOrder(actor(t), id)).ok, true);
    const refused = await dispatchOrder(actor(t), id, { dispatchedOn: today(), shipment: { deliveryCharge: "-5.00" } });
    assert.equal(refused.ok, false, "a fare is not negative");
    const sent = await dispatchOrder(actor(t), id, { dispatchedOn: today(), shipment: { vehicleNo: "DHAKA-METRO-11-2020", driverName: "Karim", driverPhone: "01711000000", deliveryCharge: "150.00", deliveryPaidWith: "CASH" } });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    const row = await prisma.shipment.findFirstOrThrow({ where: { orderId: id } });
    assert.deepEqual([row.method, row.vehicleNo, row.driverName, row.deliveryCharge.toFixed(2), row.courierId], ["OWN_VEHICLE", "DHAKA-METRO-11-2020", "Karim", "150.00", null]);
    assert.deepEqual([await roleTotal(t, "TRANSPORT"), await roleTotal(t, "COURIER_AR")], ["150.00", "0.00"]);
    assert.equal((await deliverOrder(actor(t), id)).ok, true);
    assert.equal((await prisma.shipment.findUniqueOrThrow({ where: { id: row.id } })).status, "DELIVERED");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the courier's cash is only what the customer still owes: the part paid from the advance is not collected; more than is owed is refused; a courier order needs a courier; the parcel is delivered on its shipment", async () => {
  await withTestOrg(async (t) => {
    const s = await setup(t);
    assert.equal((await postCustomerAdvance({ ...actor(t), customerId: s.customer.id, businessDate: today(), amount: "300.00", method: "CASH" })).ok, true);
    const made = await createOrder(actor(t), { customerId: s.customer.id, businessDate: today(), deliveryMethod: "COURIER", lines: [{ productId: s.product.id, quantity: "10" }] });
    assert.ok(made.ok);
    const id = made.ok ? made.id : "";
    assert.equal((await confirmOrder(actor(t), id)).ok, true);
    const noCourier = await dispatchOrder(actor(t), id, { dispatchedOn: today() });
    assert.equal(noCourier.ok, false);
    assert.match(!noCourier.ok ? noCourier.message : "", /courier/i);
    const tooMuch = await dispatchOrder(actor(t), id, { dispatchedOn: today(), tenders: [{ method: "WALLET", amount: "300.00" }], shipment: { courierId: s.courier.id, codAmount: "700.01" } });
    assert.equal(tooMuch.ok, false);
    assert.equal(await prisma.sale.count({ where: { organizationId: t.org.id } }), 0, "refused as a whole: no invoice, no stock out");
    const sent = await dispatchOrder(actor(t), id, { dispatchedOn: today(), tenders: [{ method: "WALLET", amount: "300.00" }], shipment: { courierId: s.courier.id, outsideDhaka: true } });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    const row = await prisma.shipment.findFirstOrThrow({ where: { orderId: id } });
    assert.deepEqual([row.codAmount.toFixed(2), row.deliveryCharge.toFixed(2), row.conditionCharge.toFixed(2)], ["700.00", "110.00", "7.00"], "700 to collect, the outside-Dhaka charge, 1% of 700");
    assert.equal(await courierBalance(t, s.courier.id), "583.00");
    const early = await deliverOrder(actor(t), id);
    assert.equal(early.ok, false, "the parcel is delivered on its shipment");
    assert.equal((await moveShipment(actor(t), row.id, "DELIVERED")).ok, true);
    assert.equal((await moveShipment(actor(t), row.id, "IN_TRANSIT")).ok, false, "no way back");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the same dispatch twice (a retry): one shipment, one handover", async () => {
  await withTestOrg(async (t) => {
    const s = await setup(t);
    const made = await createOrder(actor(t), { customerId: s.customer.id, businessDate: today(), deliveryMethod: "COURIER", lines: [{ productId: s.product.id, quantity: "10" }] });
    assert.ok(made.ok);
    const id = made.ok ? made.id : "";
    assert.equal((await confirmOrder(actor(t), id)).ok, true);
    const key = randomUUID();
    const input = { dispatchedOn: today(), shipment: { courierId: s.courier.id } };
    const first = await dispatchOrder(actor(t, key), id, input);
    const again = await dispatchOrder(actor(t, key), id, input);
    assert.deepEqual([first.ok, again.ok, again.ok && again.replayed], [true, true, true]);
    assert.deepEqual([await prisma.shipment.count({ where: { organizationId: t.org.id } }), await prisma.journal.count({ where: { organizationId: t.org.id, docType: "SHIPMENT" } })], [1, 1]);
    assert.equal(await courierBalance(t, s.courier.id), "930.00");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the condition dashboard: what each courier owes, what is on the way, what waits, and what has waited more than 7 days", async () => {
  await withTestOrg(async (t) => {
    const s = await setup(t);
    const other = await prisma.courier.create({ data: { organizationId: t.org.id, name: "Pathao" } });
    const onTheWay = await parcel(t, s, "10");
    const waiting = await parcel(t, s, "10");
    const old = await parcel(t, s, "10");
    await deliver(t, waiting.shipmentId);
    await deliver(t, old.shipmentId);
    await prisma.shipment.update({ where: { id: old.shipmentId }, data: { deliveredOn: new Date(`${addDays(today(), -9)}T00:00:00.000Z`) } });
    void onTheWay;
    const dues = await courierDues(t.org.id, t.branch.id);
    const mine = dues.find((d) => d.courierId === s.courier.id);
    assert.deepEqual([mine?.owed, mine?.inTransit, mine?.waiting, mine?.waitingAmount, mine?.overdue, mine?.oldestDays], ["2790.00", 1, 2, "1860.00", 1, 9]);
    assert.deepEqual(dues.find((d) => d.courierId === other.id), { courierId: other.id, name: "Pathao", owed: "0.00", inTransit: 0, waiting: 0, waitingAmount: "0.00", overdue: 0, oldestDays: 0 });
    const list = await listShipments(t.org.id, t.branch.id, undefined, { status: "IN_TRANSIT" });
    assert.equal(list.page.total, 0);
    assert.equal((await listShipments(t.org.id, t.branch.id, undefined, { status: "DELIVERED" })).page.total, 2);
    assert.equal((await listShipments(t.org.id, t.branch.id, undefined, { courierId: s.courier.id })).page.total, 3);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
