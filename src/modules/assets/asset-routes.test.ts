import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { assertBooksReconcile } from "../../core/reconcile/index.ts";
import { businessDate as today } from "../../core/time/business-date.ts";
import { prisma } from "../../lib/db/client.ts";
import { factories, withTestOrg } from "../../tests/helpers/index.ts";
import { addMonths } from "./assets.ts";

// P09: the asset routes. Writes take an Idempotency-Key and accounting.post; reading the register and the worth needs accounting.view.

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type T = Parameters<Parameters<typeof withTestOrg>[0]>[0];

async function caller(t: T) {
  const { openSession } = await import("../auth/session.ts");
  const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
  return async (route: Handler, path: string, init: { method?: string; body?: unknown; key?: string | null; params?: Record<string, string> } = {}) => {
    const method = init.method ?? "POST";
    const headers: Record<string, string> = { origin: "http://localhost", cookie: `meridian_session=${token}`, "content-type": "application/json" };
    if (method !== "GET" && init.key !== null) {
      headers["idempotency-key"] = init.key ?? randomUUID();
    }
    const response = await route(new Request(`http://localhost${path}`, { method, headers, body: method === "GET" || init.body === undefined ? undefined : JSON.stringify(init.body) }), { params: Promise.resolve(init.params ?? {}) });
    return { status: response.status, body: (await response.json()) as { data?: Record<string, unknown> & unknown[]; error?: { message: string } } };
  };
}

test("assets through the API: buy, opening, depreciation preview and run, sale, the register and the company worth", async () => {
  const assets = await import("../../app/api/v1/assets/route.ts");
  const one = await import("../../app/api/v1/assets/[id]/route.ts");
  const dispose = await import("../../app/api/v1/assets/[id]/dispose/route.ts");
  const depreciation = await import("../../app/api/v1/assets/depreciation/route.ts");
  const worth = await import("../../app/api/v1/company-worth/route.ts");
  await withTestOrg(async (t) => {
    const call = await caller(t);
    const cash = (await prisma.accountRole.findFirstOrThrow({ where: { organizationId: t.org.id, role: "CASH" } })).accountId;
    const vendor = await factories(t).vendor();
    const lastMonth = addMonths(today().slice(0, 7), -1);
    const body = { kind: "BUY", name: "Delivery van", category: "VEHICLE", purchaseDate: `${lastMonth}-01`, cost: "60000.00", usefulLifeMonths: 60, paidWith: "ACCOUNT", moneyAccountId: cash };
    const key = randomUUID();
    const made = await call(assets.POST, "/api/v1/assets", { body, key });
    const again = await call(assets.POST, "/api/v1/assets", { body, key });
    assert.deepEqual([made.status, again.status, made.body.data?.id === again.body.data?.id], [201, 200, true], JSON.stringify(made.body));
    assert.equal((await call(assets.POST, "/api/v1/assets", { body, key: null })).status, 400, "a write needs its key");
    assert.equal((await call(assets.POST, "/api/v1/assets", { body: { ...body, cost: "0" } })).status, 422);
    const owed = await call(assets.POST, "/api/v1/assets", { body: { kind: "BUY", name: "Shelving", category: "FURNITURE", purchaseDate: today(), cost: "5000.00", usefulLifeMonths: 50, paidWith: "CREDIT", vendorId: vendor.id } });
    assert.equal(owed.status, 201, JSON.stringify(owed.body));
    const opening = await call(assets.POST, "/api/v1/assets", { body: { kind: "OPENING", name: "Computer", category: "COMPUTER", purchaseDate: `${addMonths(lastMonth, -10)}-01`, cost: "36000.00", usefulLifeMonths: 36, accumulated: "10000.00" } });
    assert.equal(opening.status, 201, JSON.stringify(opening.body));

    const preview = await call(depreciation.GET, `/api/v1/assets/depreciation?month=${lastMonth}`, { method: "GET" });
    assert.deepEqual([preview.status, preview.body.data?.total, (preview.body.data?.rows as unknown as unknown[]).length], [200, "1000.00", 1], "only the van was in use last month");
    const run = await call(depreciation.POST, "/api/v1/assets/depreciation", { body: { month: lastMonth } });
    assert.deepEqual([run.status, run.body.data?.total], [201, "1000.00"]);
    assert.equal((await call(depreciation.POST, "/api/v1/assets/depreciation", { body: { month: lastMonth } })).status, 409, "a month once");
    assert.equal((await call(depreciation.POST, "/api/v1/assets/depreciation", { body: { month: "2026-13" } })).status, 400);

    const vanId = String(made.body.data?.id);
    const shown = await call(one.GET, `/api/v1/assets/${vanId}`, { method: "GET", params: { id: vanId } });
    assert.deepEqual([shown.body.data?.accumulated, shown.body.data?.bookValue, shown.body.data?.monthly], ["1000.00", "59000.00", "1000.00"]);
    const sold = await call(dispose.POST, `/api/v1/assets/${vanId}/dispose`, { body: { businessDate: today(), amount: "60000.00", moneyAccountId: cash }, params: { id: vanId } });
    assert.deepEqual([sold.status, sold.body.data?.gain], [201, "1000.00"]);
    assert.equal((await call(dispose.POST, `/api/v1/assets/${vanId}/dispose`, { body: { businessDate: today() }, params: { id: vanId } })).status, 409);

    const register = await call(assets.GET, "/api/v1/assets", { method: "GET" });
    assert.deepEqual(register.body.data?.totals, { count: 2, cost: "41000.00", accumulated: "10000.00", bookValue: "31000.00" });
    const net = await call(worth.GET, "/api/v1/company-worth", { method: "GET" });
    assert.equal(net.status, 200);
    assert.equal((net.body.data?.owns as unknown as Array<{ key: string; amount: string }>).find((line) => line.key === "fixedAssets")?.amount, "31000.00");
    await assertBooksReconcile(t.org.id, prisma, { strictInventory: true });
  });
});

test("a user without accounting.post can read the register but not add or depreciate", async () => {
  const assets = await import("../../app/api/v1/assets/route.ts");
  const depreciation = await import("../../app/api/v1/assets/depreciation/route.ts");
  await withTestOrg(
    async (t) => {
      const call = await caller(t);
      assert.equal((await call(assets.GET, "/api/v1/assets", { method: "GET" })).status, 200);
      assert.equal((await call(assets.POST, "/api/v1/assets", { body: { kind: "BUY", name: "X", category: "OTHER", purchaseDate: today(), cost: "1.00", usefulLifeMonths: 2, paidWith: "CREDIT" } })).status, 403);
      assert.equal((await call(depreciation.POST, "/api/v1/assets/depreciation", { body: { month: today().slice(0, 7) } })).status, 403);
    },
    { permissions: ["accounting.view"] },
  );
});
