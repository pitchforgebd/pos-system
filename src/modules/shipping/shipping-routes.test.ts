import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, stockedProduct, withTestOrg } from "../../tests/helpers/index.ts";

// P07: the courier and shipment routes. Each write takes an Idempotency-Key; a difference in a settlement needs its own permission.

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

test("couriers, dispatch with a courier, the parcel's way, and the settlement through the API", async () => {
  const couriers = await import("../../app/api/v1/couriers/route.ts");
  const courierOne = await import("../../app/api/v1/couriers/[id]/route.ts");
  const settle = await import("../../app/api/v1/couriers/[id]/settle/route.ts");
  const dispatch = await import("../../app/api/v1/orders/[id]/[action]/route.ts");
  const orders = await import("../../app/api/v1/orders/route.ts");
  const move = await import("../../app/api/v1/shipments/[id]/[action]/route.ts");
  const shipments = await import("../../app/api/v1/shipments/route.ts");
  const shipmentOne = await import("../../app/api/v1/shipments/[id]/route.ts");
  const { openSession } = await import("../auth/session.ts");
  await withTestOrg(async (t) => {
    const product = await stockedProduct(t, { units: 30, cost: "60.00", price: "100.00" });
    const customer = await factories(t).customer();
    const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
    const call = async (route: Handler, path: string, init: { method?: string; body?: unknown; key?: string | null; params?: Record<string, string> } = {}) => {
      const method = init.method ?? "POST";
      const headers: Record<string, string> = { origin: "http://localhost", cookie: `meridian_session=${token}`, "content-type": "application/json" };
      if (method !== "GET" && init.key !== null) {
        headers["idempotency-key"] = init.key ?? randomUUID();
      }
      const response = await route(new Request(`http://localhost${path}`, { method, headers, body: method === "GET" || init.body === undefined ? undefined : JSON.stringify(init.body) }), { params: Promise.resolve(init.params ?? {}) });
      return { status: response.status, body: (await response.json()) as { data?: Record<string, unknown> & unknown[]; error?: { message: string } } };
    };

    const made = await call(couriers.POST, "/api/v1/couriers", { body: { name: "Pathao", defaultConditionPercent: "1", defaultDeliveryCharge: "60", outsideDeliveryCharge: "110" } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const courierId = String(made.body.data?.id);
    assert.equal((await call(courierOne.PATCH, `/api/v1/couriers/${courierId}`, { method: "PATCH", body: { name: "Pathao", defaultConditionPercent: "1.5", defaultDeliveryCharge: "65", outsideDeliveryCharge: "110" }, params: { id: courierId } })).status, 200);
    assert.equal((await call(couriers.POST, "/api/v1/couriers", { body: { name: "Xpress", defaultConditionPercent: "101" } })).status, 422, "a condition charge above 100 percent");
    const list = await call(couriers.GET, "/api/v1/couriers", { method: "GET" });
    assert.deepEqual([list.status, (list.body.data as unknown as Array<{ name: string; defaultConditionPercent: string }>).find((c) => c.name === "Pathao")?.defaultConditionPercent], [200, "1.50"]);
    assert.ok((list.body.data as unknown as Array<{ name: string }>).some((c) => c.name === "Steadfast") === false, "the starter couriers are only added when there is none");

    const order = await call(orders.POST, "/api/v1/orders", { body: { customerId: customer.id, businessDate: today(), deliveryMethod: "COURIER", shippingAddress: "Mirpur", lines: [{ productId: product.id, quantity: "10" }] } });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const orderId = String(order.body.data?.id);
    assert.equal((await call(dispatch.POST, `/api/v1/orders/${orderId}/confirm`, { params: { id: orderId, action: "confirm" } })).status, 200);
    const noCourier = await call(dispatch.POST, `/api/v1/orders/${orderId}/dispatch`, { body: { dispatchedOn: today() }, params: { id: orderId, action: "dispatch" } });
    assert.equal(noCourier.status, 422, "a courier order needs its courier");
    const sent = await call(dispatch.POST, `/api/v1/orders/${orderId}/dispatch`, { body: { dispatchedOn: today(), shipment: { courierId, trackingCode: "PT-77" } }, params: { id: orderId, action: "dispatch" } });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));

    const all = await call(shipments.GET, "/api/v1/shipments?status=CREATED", { method: "GET" });
    assert.equal(all.status, 200);
    const shipmentId = String((all.body.data as unknown as Array<{ id: string }>)[0].id);
    const one = await call(shipmentOne.GET, `/api/v1/shipments/${shipmentId}`, { method: "GET", params: { id: shipmentId } });
    // COD 1000, delivery 65, condition 1.5% = 15.00
    assert.deepEqual([one.body.data?.codAmount, one.body.data?.deliveryCharge, one.body.data?.conditionCharge, one.body.data?.expectedNet, one.body.data?.trackingCode], ["1000.00", "65.00", "15.00", "920.00", "PT-77"]);
    for (const action of ["picked", "in-transit", "delivered"]) {
      const step = await call(move.POST, `/api/v1/shipments/${shipmentId}/${action}`, { params: { id: shipmentId, action } });
      assert.deepEqual([action, step.status], [action, 200]);
    }
    assert.equal((await call(move.POST, `/api/v1/shipments/${shipmentId}/lost`, { params: { id: shipmentId, action: "lost" } })).status, 409, "no way back from delivered");
    assert.equal((await call(move.POST, `/api/v1/shipments/${shipmentId}/nonsense`, { params: { id: shipmentId, action: "nonsense" } })).status, 404);

    const waiting = await call(settle.GET, `/api/v1/couriers/${courierId}/settle`, { method: "GET", params: { id: courierId } });
    assert.deepEqual([waiting.status, (waiting.body.data as unknown as Array<{ amount: string }>)[0]?.amount], [200, "920.00"]);
    const short = await call(settle.POST, `/api/v1/couriers/${courierId}/settle`, { body: { shipmentIds: [shipmentId], businessDate: today(), netReceived: "900.00" }, params: { id: courierId } });
    assert.equal(short.status, 422, "a difference needs a reason");
    const key = randomUUID();
    const body = { shipmentIds: [shipmentId], businessDate: today(), netReceived: "900.00", differenceReason: "The courier kept 20 for packing" };
    const done = await call(settle.POST, `/api/v1/couriers/${courierId}/settle`, { body, params: { id: courierId }, key });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    const replay = await call(settle.POST, `/api/v1/couriers/${courierId}/settle`, { body, params: { id: courierId }, key });
    assert.deepEqual([replay.status, replay.body.data?.replayed], [200, true]);
    assert.equal((await call(settle.POST, `/api/v1/couriers/${courierId}/settle`, { body, params: { id: courierId } })).status, 409, "settled once");
    assert.equal(await prisma.courierSettlement.count({ where: { organizationId: t.org.id } }), 1);
    assert.equal((await call(settle.POST, `/api/v1/couriers/${courierId}/settle`, { body, params: { id: courierId }, key: null })).status, 400, "no Idempotency-Key");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a user who may settle but not approve differences settles what matches and not what differs", async () => {
  const settle = await import("../../app/api/v1/couriers/[id]/settle/route.ts");
  const { openSession } = await import("../auth/session.ts");
  const { createOrder, confirmOrder, dispatchOrder } = await import("../orders/orders.ts");
  const { moveShipment } = await import("./shipments.ts");
  await withTestOrg(
    async (t) => {
      const product = await stockedProduct(t, { units: 30, cost: "60.00", price: "100.00" });
      const customer = await factories(t).customer();
      const courier = await prisma.courier.create({ data: { organizationId: t.org.id, name: "RedX", defaultConditionPercent: "1", defaultDeliveryCharge: "60" } });
      const who = (key = randomUUID()) => ({ ...t.actor, idempotencyKey: key });
      const made = await createOrder(who(), { customerId: customer.id, businessDate: today(), deliveryMethod: "COURIER", lines: [{ productId: product.id, quantity: "10" }] });
      assert.ok(made.ok);
      const id = made.ok ? made.id : "";
      assert.equal((await confirmOrder(who(), id)).ok, true);
      assert.equal((await dispatchOrder(who(), id, { dispatchedOn: today(), shipment: { courierId: courier.id } })).ok, true);
      const shipment = await prisma.shipment.findFirstOrThrow({ where: { orderId: id } });
      assert.equal((await moveShipment(who(), shipment.id, "DELIVERED")).ok, true);
      const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
      const post = async (netReceived: string, extra: Record<string, unknown> = {}) => {
        const response = await settle.POST(new Request("http://localhost/x", { method: "POST", headers: { origin: "http://localhost", cookie: `meridian_session=${token}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ shipmentIds: [shipment.id], businessDate: today(), netReceived, ...extra }) }), { params: Promise.resolve({ id: courier.id }) });
        return { status: response.status, body: (await response.json()) as { error?: { message: string } } };
      };
      const differs = await post("900.00", { differenceReason: "The courier kept 30 for packing" });
      assert.equal(differs.status, 422);
      assert.match(differs.body.error?.message ?? "", /approval/i);
      assert.equal((await post("930.00")).status, 201, "what matches needs no approval");
      await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
    },
    { permissions: ["couriers.settle", "shipments.view", "shipments.manage", "orders.view"] },
  );
});
