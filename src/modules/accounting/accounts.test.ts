import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { RuleError } from "../../core/errors/rule-error.ts";
import { ensureChart } from "../../core/ledger/chart.ts";
import { prisma } from "../../lib/db/client.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { deleteAccount, setAccountStatus } from "./accounts.ts";

const bare = { chart: false } as const;

async function setup(t: { org: { id: string } }) {
  await ensureChart(prisma, t.org.id);
  const group = await prisma.accountGroup.findFirstOrThrow({ where: { organizationId: t.org.id, code: "6000" } });
  const mine = await prisma.account.create({ data: { organizationId: t.org.id, groupId: group.id, code: "6150", name: "Tea and snacks" } });
  const system = await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id, isSystem: true, kind: "CASH" } });
  return { mine, system };
}

const is422 = (error: unknown) => error instanceof RuleError && error.status === 422;

test("a system account cannot be deactivated or deleted (N27)", async () => {
  await withTestOrg(async (t) => {
    const { system } = await setup(t);
    await assert.rejects(setAccountStatus({ organizationId: t.org.id, accountId: system.id, status: "INACTIVE" }), is422);
    await assert.rejects(deleteAccount({ organizationId: t.org.id, accountId: system.id }), is422);
    const still = await prisma.account.findUniqueOrThrow({ where: { id: system.id } });
    assert.equal(still.status, "ACTIVE");
  }, bare);
});

test("every account that has a role is a system account, so no role can lose its account", async () => {
  await withTestOrg(async (t) => {
    await setup(t);
    const roles = await prisma.accountRole.findMany({ where: { organizationId: t.org.id }, include: { account: true } });
    assert.ok(roles.length > 20);
    assert.deepEqual(roles.filter((row) => !row.account.isSystem).map((row) => row.role), []);
  }, bare);
});

test("an account of the owner's own can be closed, opened again, and deleted while nothing was posted to it", async () => {
  await withTestOrg(async (t) => {
    const { mine } = await setup(t);
    assert.equal((await setAccountStatus({ organizationId: t.org.id, accountId: mine.id, status: "INACTIVE" })).status, "INACTIVE");
    assert.equal((await setAccountStatus({ organizationId: t.org.id, accountId: mine.id, status: "ACTIVE" })).status, "ACTIVE");
    await deleteAccount({ organizationId: t.org.id, accountId: mine.id });
    assert.equal(await prisma.account.count({ where: { id: mine.id } }), 0);
  }, bare);
});

test("an account with postings on it cannot be deleted, only closed", async () => {
  await withTestOrg(async (t) => {
    const { mine } = await setup(t);
    const day = new Date("2026-10-01T00:00:00.000Z");
    await prisma.journal.create({
      data: { organizationId: t.org.id, branchId: t.branch.id, businessDate: day, status: "POSTED", lines: { create: [{ organizationId: t.org.id, accountId: mine.id, debit: "1.00", businessDate: day, branchId: t.branch.id }] } },
    });
    await assert.rejects(deleteAccount({ organizationId: t.org.id, accountId: mine.id }), (error: unknown) => error instanceof RuleError && error.status === 409);
    assert.equal(await prisma.account.count({ where: { id: mine.id } }), 1);
    assert.equal((await setAccountStatus({ organizationId: t.org.id, accountId: mine.id, status: "INACTIVE" })).status, "INACTIVE");
  }, bare);
});

test("another organization's account is not found, whatever its id", async () => {
  await withTestOrg(async (a) => {
    await withTestOrg(async (b) => {
      const { mine } = await setup(b);
      await assert.rejects(setAccountStatus({ organizationId: a.org.id, accountId: mine.id, status: "INACTIVE" }), (error: unknown) => error instanceof RuleError && error.status === 404);
      await assert.rejects(deleteAccount({ organizationId: a.org.id, accountId: mine.id }), (error: unknown) => error instanceof RuleError && error.status === 404);
    }, bare);
  }, bare);
});

test("PATCH and DELETE /api/v1/accounting/accounts/[id] answer 422 for a system account and work for the owner's own", async () => {
  const { PATCH, DELETE } = await import("../../app/api/v1/accounting/accounts/[id]/route.ts");
  const { openSession } = await import("../auth/session.ts");
  await withTestOrg(async (t) => {
    const { mine, system } = await setup(t);
    const { token } = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
    const call = async (route: typeof PATCH, id: string, body?: unknown) => {
      const response = await route(
        new Request(`http://localhost/api/v1/accounting/accounts/${id}`, { method: "PATCH", headers: { origin: "http://localhost", cookie: `meridian_session=${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }),
        { params: Promise.resolve({ id }) },
      );
      return { status: response.status, body: (await response.json()) as { error?: { message: string } } };
    };
    const denied = await call(PATCH, system.id, { status: "INACTIVE" });
    assert.equal(denied.status, 422);
    assert.match(denied.body.error?.message ?? "", /system account/i);
    assert.equal((await call(DELETE, system.id)).status, 422);
    assert.equal((await call(PATCH, mine.id, { status: "INACTIVE" })).status, 200);
    assert.equal((await call(PATCH, mine.id, { status: "nonsense" })).status, 400);
    assert.equal((await call(DELETE, mine.id)).status, 200);
  }, bare);
});
