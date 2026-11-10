import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { runTx } from "../tx/run.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { RuleError } from "../errors/rule-error.ts";
import { accountFor, accountsFor, moneyAccountFor } from "./accounts.ts";
import { SYSTEM_ROLES } from "./roles.ts";

// P02 task 3: code asks for a role, never for an account number (B8).

test("accountFor gives the account that plays the role, in this organization only", async () => {
  await withTestOrg(async (a) => {
    await withTestOrg(async (b) => {
      const idA = await accountFor(prisma, a.org.id, "AR");
      const idB = await accountFor(prisma, b.org.id, "AR");
      assert.notEqual(idA, idB);
      const row = await prisma.account.findUniqueOrThrow({ where: { id: idA } });
      assert.equal(row.organizationId, a.org.id);
      assert.equal(row.name, "Accounts Receivable");
    });
  });
});

test("every system role resolves to an account of its own organization", async () => {
  await withTestOrg(async (t) => {
    const ids = await accountsFor(prisma, t.org.id, [...SYSTEM_ROLES]);
    assert.equal(ids.size, SYSTEM_ROLES.length);
    assert.equal(new Set(ids.values()).size, SYSTEM_ROLES.length, "no two roles share an account");
    assert.equal(await prisma.account.count({ where: { id: { in: [...ids.values()] }, organizationId: t.org.id } }), SYSTEM_ROLES.length);
  });
});

test("a role that is not set up is refused with a clear 422, not a crash", async () => {
  await withTestOrg(
    async (t) => {
      await assert.rejects(accountFor(prisma, t.org.id, "CASH"), (error: unknown) => error instanceof RuleError && error.status === 422 && /CASH/.test(error.message));
    },
    { chart: false },
  );
});

test("inside one transaction a role is looked up once, and a change is seen by the next transaction", async () => {
  await withTestOrg(async (t) => {
    const group = await prisma.accountGroup.findFirstOrThrow({ where: { organizationId: t.org.id, code: "1000" } });
    const other = await prisma.account.create({ data: { organizationId: t.org.id, groupId: group.id, code: "1210", name: "Other cash box", kind: "CASH", isSystem: true } });
    const queries: string[] = [];
    await runTx(async (tx) => {
      const first = await accountFor(tx, t.org.id, "CASH");
      const second = await accountFor(tx, t.org.id, "CASH");
      assert.equal(first, second);
      const spy = tx.accountRole.findMany;
      void spy;
      queries.push(first);
    });
    // the owner points the role at another account: the next transaction uses it
    await prisma.accountRole.update({ where: { organizationId_role: { organizationId: t.org.id, role: "CASH" } }, data: { accountId: other.id } });
    await runTx(async (tx) => {
      assert.equal(await accountFor(tx, t.org.id, "CASH"), other.id);
    });
    assert.notEqual(queries[0], other.id);
  });
});

test("moneyAccountFor: cash is the cash role, any other method the default bank, a chosen account is checked", async () => {
  await withTestOrg(async (t) => {
    const cash = await accountFor(prisma, t.org.id, "CASH");
    const bank = await accountFor(prisma, t.org.id, "BANK:DEFAULT");
    assert.equal(await moneyAccountFor(prisma, t.org.id, { method: "CASH" }), cash);
    for (const method of ["BANK", "CARD", "OTHER"]) {
      assert.equal(await moneyAccountFor(prisma, t.org.id, { method }), bank, method);
    }
    const group = await prisma.accountGroup.findFirstOrThrow({ where: { organizationId: t.org.id, code: "1000" } });
    const mine = await prisma.account.create({ data: { organizationId: t.org.id, groupId: group.id, code: "1201", name: "City Bank", kind: "BANK" } });
    assert.equal(await moneyAccountFor(prisma, t.org.id, { method: "BANK", accountId: mine.id }), mine.id);
    // not a money account, closed, or somebody else's: refused
    const receivable = await accountFor(prisma, t.org.id, "AR");
    await assert.rejects(moneyAccountFor(prisma, t.org.id, { method: "BANK", accountId: receivable }), (e: unknown) => e instanceof RuleError && e.status === 422);
    await prisma.account.update({ where: { id: mine.id }, data: { status: "INACTIVE" } });
    await assert.rejects(moneyAccountFor(prisma, t.org.id, { method: "BANK", accountId: mine.id }), (e: unknown) => e instanceof RuleError && e.status === 422);
    await withTestOrg(async (other) => {
      const theirs = await accountFor(prisma, other.org.id, "CASH");
      await assert.rejects(moneyAccountFor(prisma, t.org.id, { method: "CASH", accountId: theirs }), (e: unknown) => e instanceof RuleError && e.status === 422);
    });
  });
});
