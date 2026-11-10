import "./env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";
import { permissionCodes } from "../../lib/permissions/codes.ts";
import { verifyPassword } from "../../modules/auth/password.ts";
import {
  TEST_PASSWORD,
  concurrently,
  concurrentlySettled,
  countOrgRows,
  factories,
  orgTablePlan,
  testOrg,
  withTestOrg,
} from "./index.ts";

test("the organization tables found in the database are the Prisma models that have an organizationId", async () => {
  const plan = await orgTablePlan();
  const models = Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === "organizationId"))
    .map((model) => model.dbName ?? model.name);
  assert.deepEqual([...plan.order].sort(), [...models].sort());
  assert.equal(plan.order.includes("organizations"), false);
  assert.equal(plan.order.includes("permissions"), false);
});

test("testOrg builds a usable organization, factories add rows, and cleanup removes every row", async () => {
  const t = await testOrg();
  const catalog = await prisma.permission.count({ where: { code: { in: [...permissionCodes] } } });
  assert.equal(catalog, permissionCodes.length);

  assert.equal(t.warehouse.branchId, t.branch.id);
  assert.equal(t.actor.organizationId, t.org.id);
  assert.equal(t.actor.userId, t.owner.id);
  assert.equal(await verifyPassword(TEST_PASSWORD, t.owner.passwordHash), true);
  assert.equal(await prisma.rolePermission.count({ where: { roleId: t.role.id } }), permissionCodes.length);
  assert.equal(await prisma.userBranchAccess.count({ where: { userId: t.owner.id, branchId: t.branch.id } }), 1);
  assert.equal((await prisma.account.count({ where: { organizationId: t.org.id } })) > 0, true);

  const f = factories(t);
  const first = await f.product();
  const second = await f.product({ name: "Named" });
  assert.notEqual(first.sku, second.sku);
  assert.notEqual(first.slug, second.slug);
  assert.equal(second.name, "Named");
  const customer = await f.customer();
  const vendor = await f.vendor();
  assert.equal(customer.organizationId, t.org.id);
  assert.equal(vendor.organizationId, t.org.id);

  const leftBefore = await countOrgRows(t.org.id);
  assert.equal((leftBefore.products ?? 0) >= 2, true);

  await t.cleanup();
  assert.deepEqual(await countOrgRows(t.org.id), {});
  assert.equal(await prisma.organization.count({ where: { id: t.org.id } }), 0);
  assert.equal(await prisma.permission.count({ where: { code: { in: [...permissionCodes] } } }), catalog);

  await t.cleanup();
});

test("testOrg can limit the permissions and skip the chart, and withTestOrg always cleans up", async () => {
  let orgId = "";
  await withTestOrg(
    async (t) => {
      orgId = t.org.id;
      assert.equal(await prisma.rolePermission.count({ where: { roleId: t.role.id } }), 1);
      assert.equal(await prisma.account.count({ where: { organizationId: t.org.id } }), 0);
    },
    { permissions: ["sales.view"], chart: false },
  );
  assert.equal(await prisma.organization.count({ where: { id: orgId } }), 0);

  await assert.rejects(
    withTestOrg(async (t) => {
      orgId = t.org.id;
      throw new Error("a failing test body");
    }),
    /a failing test body/,
  );
  assert.equal(await prisma.organization.count({ where: { id: orgId } }), 0);
});

test("concurrently starts every call before any finishes and reports every failure", async () => {
  let running = 0;
  let peak = 0;
  const results = await concurrently(6, async (index) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 20));
    running -= 1;
    return index * 2;
  });
  assert.deepEqual(results, [0, 2, 4, 6, 8, 10]);
  assert.equal(peak, 6);

  const settled = await concurrentlySettled(4, async (index) => {
    if (index % 2 === 1) {
      throw new Error(`boom ${index}`);
    }
    return index;
  });
  assert.deepEqual(
    settled.map((result) => result.status),
    ["fulfilled", "rejected", "fulfilled", "rejected"],
  );

  await assert.rejects(
    concurrently(3, async (index) => {
      if (index === 1) {
        throw new Error("boom");
      }
      return index;
    }),
    (error: unknown) => error instanceof AggregateError && error.errors.length === 1,
  );
});

test("several organizations can be set up, used and cleaned up at the same time", async () => {
  for (let round = 0; round < 3; round += 1) {
    const results = await concurrentlySettled(6, async () => {
      const t = await testOrg();
      const f = factories(t);
      for (let index = 0; index < 3; index += 1) {
        await f.product();
        await f.customer();
        await f.vendor();
      }
      await t.cleanup();
      return t.org.id;
    });
    const failed = results.filter((result) => result.status === "rejected");
    assert.equal(failed.length, 0, failed.map((result) => String((result as PromiseRejectedResult).reason)).join("\n"));
    for (const result of results) {
      assert.deepEqual(await countOrgRows((result as PromiseFulfilledResult<string>).value), {});
    }
  }
});

// The failure this guards against: another test's cleanup (`DELETE ... WHERE organizationId = ?`) scans a
// whole table, and under REPEATABLE READ it locks the rows and gaps it passes, so a posting that is
// running at the same time (a journal and its lines in one transaction) ends in a deadlock.
test("cleanup does not deadlock with postings that are running at the same time", async () => {
  const stable = await testOrg();
  const stableAccount = await prisma.account.findFirstOrThrow({ where: { organizationId: stable.org.id } });
  const post = (organizationId: string, accountId: string) =>
    prisma.$transaction(async (tx) => {
      const journal = await tx.journal.create({ data: { organizationId, businessDate: new Date("2026-10-01T00:00:00.000Z") } });
      await tx.journalLine.createMany({
        data: [
          { organizationId, journalId: journal.id, accountId, debit: "1.00", businessDate: new Date("2026-10-01T00:00:00.000Z") },
          { organizationId, journalId: journal.id, accountId, credit: "1.00", businessDate: new Date("2026-10-01T00:00:00.000Z") },
        ],
      });
    });

  const state = { stop: false };
  const posters = concurrentlySettled(3, async () => {
    let posted = 0;
    while (!state.stop) {
      await post(stable.org.id, stableAccount.id);
      posted += 1;
    }
    return posted;
  });
  const cleaners = concurrentlySettled(3, async () => {
    let cleaned = 0;
    const until = Date.now() + 4000;
    while (Date.now() < until) {
      const t = await testOrg();
      const account = await prisma.account.findFirstOrThrow({ where: { organizationId: t.org.id } });
      await post(t.org.id, account.id);
      await post(t.org.id, account.id);
      await t.cleanup();
      cleaned += 1;
    }
    return cleaned;
  });

  const cleanerResults = await cleaners;
  state.stop = true;
  const posterResults = await posters;
  await stable.cleanup();

  const failed = [...cleanerResults, ...posterResults].filter((result) => result.status === "rejected");
  const why = (result: PromiseSettledResult<number>) => {
    const reason = (result as PromiseRejectedResult).reason as { code?: string; message?: string };
    const lines = String(reason?.message ?? reason).split("\n").map((line) => line.trim()).filter(Boolean);
    return `${reason?.code ?? ""} ${lines[0]} -> ${lines[lines.length - 1]}`;
  };
  assert.equal(failed.length, 0, failed.map(why).join("\n"));
  const cleaned = cleanerResults.reduce((sum, result) => sum + (result as PromiseFulfilledResult<number>).value, 0);
  const posted = posterResults.reduce((sum, result) => sum + (result as PromiseFulfilledResult<number>).value, 0);
  assert.equal(cleaned >= 3 && posted >= 3, true, `the test must overlap work: cleaned ${cleaned}, posted ${posted}`);
});
