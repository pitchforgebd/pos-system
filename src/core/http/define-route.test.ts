import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { z } from "zod";

import { basePrisma, prisma } from "../../lib/db/client.ts";
import { jsonError, jsonOk } from "../../lib/api/http.ts";
import { hashPayload, idempotentTransaction, readIdempotency, saveIdempotency } from "../idempotency/index.ts";
import { concurrently } from "../../tests/helpers/index.ts";
import { writeAudit } from "../../modules/auth/audit.ts";
import { openSession } from "../../modules/auth/session.ts";
import { postBalancedJournal } from "../../modules/accounting/post.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { RuleError } from "../errors/rule-error.ts";
import { addDays, businessDate } from "../time/business-date.ts";
import { isoDate } from "../time/iso-date.ts";
import { defineRoute } from "./define-route.ts";

type Org = Parameters<Parameters<typeof withTestOrg>[0]>[0];

async function call(t: Org, route: (request: Request, context?: unknown) => Promise<Response>, init: { method?: string; body?: unknown; headers?: Record<string, string>; origin?: string | null; signedIn?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
  if (init.origin !== null) {
    headers.origin = init.origin ?? "http://localhost";
  }
  if (init.signedIn !== false) {
    const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
    headers.cookie = `meridian_session=${token}`;
  }
  const response = await route(
    new Request("http://localhost/api/test", { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }),
  );
  return { status: response.status, body: (await response.json()) as { success: boolean; data?: Record<string, unknown>; error?: { code: string; message: string; fields: Record<string, string> } } };
}

test("a guarded route answers 401 without a session and 403 without the permission", async () => {
  await withTestOrg(async (t) => {
    const route = defineRoute({ permission: "sales.create", handler: async () => jsonOk({ ok: true }) });
    const anonymous = await call(t, route, { signedIn: false });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.error?.code, "AUTHENTICATION_ERROR");
    const allowed = await call(t, route);
    assert.equal(allowed.status, 200);
  });
  await withTestOrg(
    async (t) => {
      const route = defineRoute({ permission: "sales.create", handler: async () => jsonOk({ ok: true }) });
      const denied = await call(t, route);
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error?.code, "AUTHORIZATION_ERROR");
    },
    { permissions: ["sales.view"] },
  );
});

test("a write from another site is refused before anything else (CSRF)", async () => {
  await withTestOrg(async (t) => {
    let ran = false;
    const route = defineRoute({ permission: "sales.create", handler: async () => ((ran = true), jsonOk({})) });
    assert.equal((await call(t, route, { origin: "http://evil.example" })).status, 403);
    assert.equal((await call(t, route, { origin: null })).status, 403);
    assert.equal(ran, false);
    // A read needs no origin.
    const read = defineRoute({ permission: "sales.view", handler: async () => jsonOk({ ok: true }) });
    assert.equal((await call(t, read, { method: "GET", origin: null })).status, 200);
  });
});

test("the body is checked with zod: a bad field is a 400 with the field named, and an impossible date is a 400, not a 500", async () => {
  await withTestOrg(async (t) => {
    const route = defineRoute({
      permission: "sales.create",
      body: z.object({ name: z.string().min(1), businessDate: isoDate }),
      handler: async ({ body }) => jsonOk({ name: body.name, businessDate: body.businessDate }),
    });
    const good = await call(t, route, { body: { name: "x", businessDate: "2026-02-28" } });
    assert.equal(good.status, 200);
    assert.deepEqual(good.body.data, { name: "x", businessDate: "2026-02-28" });
    const impossible = await call(t, route, { body: { name: "x", businessDate: "2026-02-31" } });
    assert.equal(impossible.status, 400);
    assert.equal(impossible.body.error?.code, "VALIDATION_ERROR");
    assert.equal(typeof impossible.body.error?.fields.businessDate, "string");
    assert.equal((await call(t, route, { body: { businessDate: "2026-02-28" } })).status, 400);
    assert.equal((await call(t, route, { body: "not json" })).status, 400);
  });
});

test("an idempotent route needs an Idempotency-Key header", async () => {
  await withTestOrg(async (t) => {
    const route = defineRoute({ permission: "sales.create", idempotent: true, handler: async ({ idempotencyKey }) => jsonOk({ key: idempotencyKey }) });
    const missing = await call(t, route);
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error?.code, "VALIDATION_ERROR");
    assert.equal((await call(t, route, { headers: { "idempotency-key": "nope" } })).status, 400);
    const key = randomUUID();
    const ok = await call(t, route, { headers: { "idempotency-key": key } });
    assert.deepEqual(ok.body.data, { key });
  });
});

test("a business rule is a 422 answer, a missing record 404, a conflict 409, and an unexpected error is a 500 that leaks nothing", async () => {
  await withTestOrg(async (t) => {
    const throwing = (error: unknown) => defineRoute({ permission: "sales.create", handler: async () => { throw error; } });
    const rule = await call(t, throwing(new RuleError("closed for today", 422)));
    assert.deepEqual([rule.status, rule.body.error?.code, rule.body.error?.message], [422, "BUSINESS_RULE", "closed for today"]);
    assert.deepEqual((await call(t, throwing(new RuleError("no such thing", 404)))).body.error?.code, "NOT_FOUND");
    assert.deepEqual((await call(t, throwing(new RuleError("again", 409)))).body.error?.code, "CONFLICT");
    const boom = await call(t, throwing(new Error("SELECT secret FROM users failed at host db-internal")));
    assert.equal(boom.status, 500);
    assert.equal(boom.body.error?.code, "INTERNAL_ERROR");
    assert.equal(JSON.stringify(boom.body).includes("secret"), false);
  });
});

test("the document and its audit row are saved in one transaction; if the audit fails, the document is not saved", async () => {
  await withTestOrg(async (t) => {
    const audit = (action: string) => writeAudit({ organizationId: t.org.id, userId: t.owner.id, action, module: "test", entityType: "branch" });
    const make = (name: string, action: string) =>
      defineRoute({
        permission: "sales.create",
        handler: async () => {
          await prisma.branch.create({ data: { organizationId: t.org.id, name } });
          await audit(action);
          return jsonOk({ name });
        },
      });

    assert.equal((await call(t, make("saved", "branch_created"))).status, 200);
    assert.equal(await basePrisma.branch.count({ where: { organizationId: t.org.id, name: "saved" } }), 1);
    assert.equal(await basePrisma.auditLog.count({ where: { organizationId: t.org.id, action: "branch_created" } }), 1);

    // An action longer than the column cannot be written: the whole request rolls back.
    const failed = await call(t, make("not saved", "x".repeat(200)));
    assert.equal(failed.status, 500);
    assert.equal(await basePrisma.branch.count({ where: { organizationId: t.org.id, name: "not saved" } }), 0);
  });
});

test("a refused request (4xx) leaves nothing behind, not even work done before the refusal", async () => {
  await withTestOrg(async (t) => {
    const route = defineRoute({
      permission: "sales.create",
      handler: async () => {
        await prisma.branch.create({ data: { organizationId: t.org.id, name: "half done" } });
        throw new RuleError("refused after a write", 422);
      },
    });
    assert.equal((await call(t, route)).status, 422);
    assert.equal(await basePrisma.branch.count({ where: { organizationId: t.org.id, name: "half done" } }), 0);

    const returned = defineRoute({
      permission: "sales.create",
      handler: async () => {
        await prisma.branch.create({ data: { organizationId: t.org.id, name: "half done 2" } });
        return Response.json({ success: false, error: { code: "BUSINESS_RULE", message: "no", fields: {} } }, { status: 422 });
      },
    });
    assert.equal((await call(t, returned)).status, 422);
    assert.equal(await basePrisma.branch.count({ where: { organizationId: t.org.id, name: "half done 2" } }), 0);
  });
});

test("a journal for tomorrow or for a locked day is a 422 answer through the route, and nothing is saved", async () => {
  await withTestOrg(async (t) => {
    const today = businessDate();
    const route = defineRoute({
      permission: "accounting.post",
      body: z.object({ businessDate: isoDate }),
      handler: async ({ body }) => {
        await postBalancedJournal(prisma, {
          organizationId: t.org.id,
          branchId: t.branch.id,
          businessDate: new Date(`${body.businessDate}T00:00:00.000Z`),
          description: "route test",
          createdById: t.owner.id,
          lines: [
            { accountCode: "1100", debit: new (await import("@prisma/client")).Prisma.Decimal("5.00"), credit: new (await import("@prisma/client")).Prisma.Decimal(0) },
            { accountCode: "1300", debit: new (await import("@prisma/client")).Prisma.Decimal(0), credit: new (await import("@prisma/client")).Prisma.Decimal("5.00") },
          ],
        });
        return jsonOk({ posted: true });
      },
    });
    const future = await call(t, route, { body: { businessDate: addDays(today, 1) } });
    assert.equal(future.status, 422);
    assert.match(future.body.error?.message ?? "", /future/);
    await basePrisma.organization.update({ where: { id: t.org.id }, data: { lockedThrough: new Date(`${addDays(today, -5)}T00:00:00.000Z`) } });
    const locked = await call(t, route, { body: { businessDate: addDays(today, -5) } });
    assert.equal(locked.status, 422);
    assert.match(locked.body.error?.message ?? "", /locked/);
    assert.equal(await basePrisma.journal.count({ where: { organizationId: t.org.id } }), 0);
    assert.equal((await call(t, route, { body: { businessDate: today } })).status, 200);
    assert.equal(await basePrisma.journal.count({ where: { organizationId: t.org.id } }), 1);
  });
});

test("a public route needs no session, but a write to it still checks the origin", async () => {
  await withTestOrg(async (t) => {
    const route = defineRoute({ public: true, handler: async () => jsonOk({ hello: true }) });
    assert.equal((await call(t, route, { signedIn: false })).status, 200);
    assert.equal((await call(t, route, { signedIn: false, origin: "http://evil.example" })).status, 403);
  });
});

test("the route receives its URL parameters already resolved", async () => {
  await withTestOrg(async (t) => {
    const route = defineRoute<{ id: string }>({ permission: "sales.view", handler: async ({ params }) => jsonOk({ id: params.id }) });
    const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
    const response = await route(new Request("http://localhost/api/test/42", { method: "GET", headers: { cookie: `meridian_session=${token}` } }), { params: Promise.resolve({ id: "42" }) });
    assert.deepEqual(((await response.json()) as { data: unknown }).data, { id: "42" });
  });
});

test("ten parallel requests with one Idempotency-Key through a route create one record and all get the same answer", async () => {
  await withTestOrg(async (t) => {
    const route = defineRoute({
      permission: "sales.create",
      idempotent: true,
      handler: async ({ idempotencyKey }) => {
        const requestHash = hashPayload({ kind: "invoice" });
        const answer = await idempotentTransaction(async (tx) => {
          const existing = await readIdempotency(tx, { organizationId: t.org.id, key: idempotencyKey as string, requestHash });
          if (existing && existing !== "mismatch") {
            return { id: existing.entityId, replayed: true, number: null as string | null };
          }
          const branch = await tx.branch.create({ data: { organizationId: t.org.id, name: "Invoice" } });
          await saveIdempotency(tx, { organizationId: t.org.id, userId: t.owner.id, key: idempotencyKey as string, requestHash, entityType: "branch", entityId: branch.id });
          return { id: branch.id, replayed: false, number: "INV-2627-000007" };
        });
        return jsonOk(answer, "Operation completed", 200);
      },
    });
    const key = randomUUID();
    const results = await concurrently(10, () => call(t, route, { headers: { "idempotency-key": key } }));
    assert.equal(results.every((result) => result.status === 200), true);
    assert.equal(new Set(results.map((result) => result.body.data?.id)).size, 1);
    assert.equal(results.every((result) => result.body.data?.number === "INV-2627-000007"), true);
    assert.equal(results.filter((result) => result.body.data?.replayed === false).length, 1);
    assert.equal(await basePrisma.branch.count({ where: { organizationId: t.org.id, name: "Invoice" } }), 1);
  });
});

test("a request that is run again after a key race still has its body, whether the handler or defineRoute reads it", async () => {
  await withTestOrg(async (t) => {
    const work = async (idempotencyKey: string, name: string) => {
      const requestHash = hashPayload({ name });
      return idempotentTransaction(async (tx) => {
        const existing = await readIdempotency(tx, { organizationId: t.org.id, key: idempotencyKey, requestHash });
        if (existing && existing !== "mismatch") {
          return { id: existing.entityId, replayed: true, name: null as string | null };
        }
        const branch = await tx.branch.create({ data: { organizationId: t.org.id, name } });
        await saveIdempotency(tx, { organizationId: t.org.id, userId: t.owner.id, key: idempotencyKey, requestHash, entityType: "branch", entityId: branch.id });
        return { id: branch.id, replayed: false, name };
      });
    };
    const readsItself = defineRoute({
      permission: "sales.create",
      idempotent: true,
      handler: async ({ request, idempotencyKey }) => {
        const sent = (await request.json().catch(() => null)) as { name?: string } | null;
        if (!sent?.name) {
          return jsonError("VALIDATION_ERROR", "The body was empty.", 400);
        }
        return jsonOk(await work(idempotencyKey as string, sent.name), "Operation completed", 200);
      },
    });
    const parsedByRoute = defineRoute({
      permission: "sales.create",
      idempotent: true,
      body: z.object({ name: z.string().min(1) }),
      handler: async ({ body, request, idempotencyKey }) => {
        // Reading the body again in the handler must also work: it is a copy built for this attempt.
        const again = (await request.json().catch(() => null)) as { name?: string } | null;
        assert.equal(again?.name, body.name);
        return jsonOk(await work(idempotencyKey as string, body.name), "Operation completed", 200);
      },
    });
    for (const [route, name] of [[readsItself, "Body read by the handler"], [parsedByRoute, "Body read by defineRoute"]] as const) {
      const key = randomUUID();
      const results = await concurrently(10, () => call(t, route, { headers: { "idempotency-key": key }, body: { name } }));
      assert.deepEqual(results.filter((result) => result.status !== 200).map((result) => `${result.status} ${result.body.error?.message}`), []);
      assert.equal(new Set(results.map((result) => result.body.data?.id)).size, 1);
      assert.equal(results.filter((result) => result.body.data?.replayed === false).length, 1);
      assert.equal(await basePrisma.branch.count({ where: { organizationId: t.org.id, name } }), 1);
    }
  });
});
