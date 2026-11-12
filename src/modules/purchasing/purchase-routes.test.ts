import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";

// P05 task 10: the purchase and vendor-money routes. Each write needs an Idempotency-Key; the answers carry the new status.

test("a purchase goes from draft to ordered to received through the API; the cost preview and the product search answer; no key is a 400", async () => {
  const purchases = await import("../../app/api/v1/purchases/route.ts");
  const one = await import("../../app/api/v1/purchases/[id]/route.ts");
  const order = await import("../../app/api/v1/purchases/[id]/order/route.ts");
  const receive = await import("../../app/api/v1/purchases/[id]/receive/route.ts");
  const cancel = await import("../../app/api/v1/purchases/[id]/cancel/route.ts");
  const cost = await import("../../app/api/v1/purchases/cost/route.ts");
  const search = await import("../../app/api/v1/purchases/products/route.ts");
  const { openSession } = await import("../auth/session.ts");
  await withTestOrg(async (t) => {
    const f = factories(t);
    const product = await f.product({ name: "Rice 50kg", sku: "RICE-50" });
    const vendor = await f.vendor({ name: "Mill" });
    const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
    const call = async (route: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>, path: string, init: { method?: string; body?: unknown; key?: string | null; params?: Record<string, string> } = {}) => {
      const method = init.method ?? "POST";
      const headers: Record<string, string> = { origin: "http://localhost", cookie: `meridian_session=${token}`, "content-type": "application/json" };
      if (method !== "GET" && init.key !== null) {
        headers["idempotency-key"] = init.key ?? randomUUID();
      }
      const response = await route(new Request(`http://localhost${path}`, { method, headers, body: method === "GET" || init.body === undefined ? undefined : JSON.stringify(init.body) }), { params: Promise.resolve(init.params ?? {}) });
      return { status: response.status, body: (await response.json()) as { data?: Record<string, unknown> & unknown[]; error?: { message: string } } & Record<string, unknown> };
    };
    const line = { productId: product.id, quantity: "10", unitCost: "50.00", vatRate: "5" };
    const base = { supplierId: vendor.id, businessDate: "2026-11-01", headerDiscount: "25.00", transportCost: "40.00", transportPaidWith: "CASH", lines: [line] };

    assert.equal((await call(purchases.POST, "/api/v1/purchases", { body: { ...base, mode: "draft" }, key: null })).status, 400, "no Idempotency-Key");
    const found = await call(search.GET, "/api/v1/purchases/products?q=rice", { method: "GET" });
    assert.deepEqual([found.status, (found.body.data as unknown as Array<{ sku: string; lastCost: string }>)[0]?.sku], [200, "RICE-50"]);
    const shown = await call(cost.POST, "/api/v1/purchases/cost", { body: { ...base, key: undefined } });
    // 10 x 50 = 500 less 25 = 475, VAT 5% = 23.75 -> 498.75 owed; haulage 40.00
    assert.deepEqual([shown.status, shown.body.data?.total, shown.body.data?.landedTotal], [200, "498.75", "538.75"]);

    const draft = await call(purchases.POST, "/api/v1/purchases", { body: { ...base, mode: "draft" } });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const id = String(draft.body.data?.id);
    assert.equal(draft.body.data?.status, "DRAFT");
    const changed = await call(one.PATCH, `/api/v1/purchases/${id}`, { method: "PATCH", body: { ...base, lines: [{ ...line, quantity: "20" }] }, params: { id } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const ordered = await call(order.POST, `/api/v1/purchases/${id}/order`, { params: { id } });
    assert.deepEqual([ordered.status, ordered.body.data?.status], [200, "ORDERED"]);
    const key = randomUUID();
    const received = await call(receive.POST, `/api/v1/purchases/${id}/receive`, { body: { receivedOn: "2026-11-03" }, params: { id }, key });
    assert.deepEqual([received.status, received.body.data?.status], [200, "RECEIVED"]);
    const replay = await call(receive.POST, `/api/v1/purchases/${id}/receive`, { body: { receivedOn: "2026-11-03" }, params: { id }, key });
    assert.deepEqual([replay.status, replay.body.data?.replayed], [200, true]);
    assert.equal((await call(cancel.POST, `/api/v1/purchases/${id}/cancel`, { params: { id } })).status, 409, "a received purchase cannot be cancelled");
    const read = await call(one.GET, `/api/v1/purchases/${id}`, { method: "GET", params: { id } });
    assert.deepEqual([read.status, read.body.data?.status, read.body.data?.total], [200, "RECEIVED", "1023.75"]); // 20 x 50 = 1000, less 25 = 975, VAT 5% = 48.75
    assert.equal(await prisma.stockLedger.count({ where: { organizationId: t.org.id, movementType: "PURCHASE" } }), 1);
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("the vendor routes: pay with a charge from an account, pay ahead, use the advance; more than owed is a 422", async () => {
  const payments = await import("../../app/api/v1/suppliers/[id]/payments/route.ts");
  const advances = await import("../../app/api/v1/suppliers/[id]/advances/route.ts");
  const apply = await import("../../app/api/v1/suppliers/[id]/advances/apply/route.ts");
  const purchases = await import("../../app/api/v1/purchases/route.ts");
  const { createBankAccount } = await import("../accounting/books.ts");
  const { openSession } = await import("../auth/session.ts");
  await withTestOrg(async (t) => {
    const f = factories(t);
    const product = await f.product();
    const vendor = await f.vendor();
    const wallet = await createBankAccount({ ip: "127.0.0.1", userAgent: "test", organizationId: t.org.id, branchId: t.branch.id, userId: t.owner.id, idempotencyKey: randomUUID(), name: "bKash", kind: "MOBILE", accountNumber: "01711-000000" });
    assert.equal(wallet.ok, true);
    const account = await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, name: "bKash" } });
    const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
    const call = async (route: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>, path: string, body: unknown, params: Record<string, string> = {}) => {
      const response = await route(new Request(`http://localhost${path}`, { method: "POST", headers: { origin: "http://localhost", cookie: `meridian_session=${token}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) }), { params: Promise.resolve(params) });
      return { status: response.status, body: (await response.json()) as { data?: Record<string, unknown>; error?: { message: string } } };
    };
    const bought = await call(purchases.POST, "/api/v1/purchases", { supplierId: vendor.id, businessDate: "2026-11-01", mode: "received", lines: [{ productId: product.id, quantity: "10", unitCost: "100.00" }] });
    assert.equal(bought.status, 201, JSON.stringify(bought.body));
    const pay = (body: unknown) => call(payments.POST, `/api/v1/suppliers/${vendor.id}/payments`, body, { id: vendor.id });

    const over = await pay({ businessDate: "2026-11-02", amount: "1000.01", method: "CASH" });
    assert.equal(over.status, 422);
    assert.match(over.body.error?.message ?? "", /advance/i);
    const paid = await pay({ businessDate: "2026-11-02", amount: "600.00", method: "MOBILE", accountId: account.id, charge: "11.00" });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    const row = await prisma.supplierPayment.findFirstOrThrow({ where: { organizationId: t.org.id } });
    assert.deepEqual([row.method, row.charge.toFixed(2)], ["MOBILE", "11.00"]);
    assert.equal((await pay({ businessDate: "2026-11-02", amount: "1.00", method: "MOBILE" })).status, 422, "a mobile payment names its account");

    const ahead = await call(advances.POST, `/api/v1/suppliers/${vendor.id}/advances`, { businessDate: "2026-11-03", amount: "300.00", method: "CASH" }, { id: vendor.id });
    assert.equal(ahead.status, 201, JSON.stringify(ahead.body));
    const used = await call(apply.POST, `/api/v1/suppliers/${vendor.id}/advances/apply`, { businessDate: "2026-11-04", amount: "300.00" }, { id: vendor.id });
    assert.equal(used.status, 201, JSON.stringify(used.body));
    assert.equal((await call(apply.POST, `/api/v1/suppliers/${vendor.id}/advances/apply`, { businessDate: "2026-11-04", amount: "0.01" }, { id: vendor.id })).status, 422, "none is held any more");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});
