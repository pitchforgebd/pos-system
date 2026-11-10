import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { accountGroups as chartGroups, accounts as chartAccounts } from "../../../prisma/chart-of-accounts.ts";
import { prisma } from "../../lib/db/client.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { ensureChart } from "./chart.ts";
import { PARTY_ROLES, SYSTEM_ROLES } from "./roles.ts";

// P02 task 2: the chart of accounts v2 (02_ACCOUNTING_MODEL.md section 1) and the roles that name its accounts.

const bare = { chart: false } as const;

async function rolesOf(organizationId: string) {
  const rows = await prisma.accountRole.findMany({ where: { organizationId }, include: { account: true } });
  return new Map(rows.map((row) => [row.role, row.account]));
}

test("a new organization gets the whole chart: every account, every role, system accounts flagged", async () => {
  await withTestOrg(async (t) => {
    await ensureChart(prisma, t.org.id);
    const accounts = await prisma.account.findMany({ where: { organizationId: t.org.id } });
    assert.equal(accounts.length, chartAccounts.length);
    const byCode = new Map(accounts.map((account) => [account.code, account]));
    for (const wanted of chartAccounts) {
      const row = byCode.get(wanted.code);
      assert.ok(row, `account ${wanted.code} exists`);
      assert.equal(row.name, wanted.name);
      assert.equal(row.isSystem, wanted.role !== undefined, `${wanted.code} is a system account exactly when it has a role`);
      assert.equal(row.kind, wanted.kind ?? "OTHER");
    }
    const roles = await rolesOf(t.org.id);
    assert.deepEqual([...roles.keys()].sort(), [...SYSTEM_ROLES].sort(), "every system role is mapped, and nothing else");
    assert.equal(roles.get("CASH")?.kind, "CASH");
    assert.equal(roles.get("BANK:DEFAULT")?.kind, "BANK");
    // the groups the accounts hang under
    assert.equal(await prisma.accountGroup.count({ where: { organizationId: t.org.id } }), chartGroups.length);
  }, bare);
});

test("the roles in the chart and the role list in code are the same set, each used once, and party roles are party-typed", () => {
  const inChart = chartAccounts.flatMap((account) => (account.role ? [account.role] : []));
  assert.equal(new Set(inChart).size, inChart.length, "a role is given to one account only");
  assert.deepEqual([...inChart].sort(), [...SYSTEM_ROLES].sort());
  assert.deepEqual(Object.keys(PARTY_ROLES).sort(), ["AP", "AR", "COURIER_AR", "CUSTOMER_ADVANCE", "VENDOR_ADVANCE"]);
  const codes = chartAccounts.map((account) => account.code);
  assert.equal(new Set(codes).size, codes.length, "an account code appears once");
});

test("running it again changes nothing", async () => {
  await withTestOrg(async (t) => {
    await ensureChart(prisma, t.org.id);
    const before = await prisma.account.findMany({ where: { organizationId: t.org.id }, orderBy: { code: "asc" } });
    await ensureChart(prisma, t.org.id);
    await ensureChart(prisma, t.org.id);
    const after = await prisma.account.findMany({ where: { organizationId: t.org.id }, orderBy: { code: "asc" } });
    assert.deepEqual(after.map((a) => [a.id, a.code, a.name, a.kind, a.isSystem]), before.map((a) => [a.id, a.code, a.name, a.kind, a.isSystem]));
    assert.equal(await prisma.accountRole.count({ where: { organizationId: t.org.id } }), SYSTEM_ROLES.length);
  }, bare);
});

test("an organization with the old chart is upgraded in place: same account rows, new accounts added, roles mapped", async () => {
  await withTestOrg(async (t) => {
    // the chart the first version of the system seeded
    const groups = new Map<string, string>();
    for (const [code, name] of [["1000", "Assets"], ["2000", "Liabilities"], ["3000", "Equity"], ["4000", "Revenue"], ["5000", "Cost of Sales"], ["6000", "Expenses"]]) {
      groups.set(code, (await prisma.accountGroup.create({ data: { organizationId: t.org.id, code, name } })).id);
    }
    const old: Array<[string, string, string]> = [
      ["1100", "Cash", "1000"], ["1200", "Bank", "1000"], ["1300", "Accounts Receivable", "1000"], ["1400", "Inventory", "1000"],
      ["2100", "Accounts Payable", "2000"], ["2200", "Loans", "2000"], ["2300", "VAT Payable", "2000"],
      ["3100", "Owner Capital", "3000"], ["3200", "Drawings", "3000"], ["4100", "Sales", "4000"], ["4200", "Other Income", "4000"],
      ["5100", "COGS", "5000"], ["6100", "Rent", "6000"], ["6200", "Salary", "6000"],
    ];
    const ids = new Map<string, string>();
    for (const [code, name, group] of old) {
      ids.set(code, (await prisma.account.create({ data: { organizationId: t.org.id, groupId: groups.get(group) as string, code, name } })).id);
    }
    // a bank account the owner added, and an account of their own
    await prisma.account.create({ data: { organizationId: t.org.id, groupId: groups.get("1000") as string, code: "1201", name: "City Bank", kind: "BANK" } });
    const own = await prisma.account.create({ data: { organizationId: t.org.id, groupId: groups.get("6000") as string, code: "6150", name: "Tea and snacks" } });

    await ensureChart(prisma, t.org.id);

    const after = new Map((await prisma.account.findMany({ where: { organizationId: t.org.id } })).map((a) => [a.code, a]));
    for (const [code, id] of ids) {
      assert.equal(after.get(code)?.id, id, `${code} is the same row, so the journal lines on it still point at it`);
    }
    assert.equal(after.get("1100")?.kind, "CASH");
    assert.equal(after.get("1200")?.kind, "BANK");
    assert.equal(after.get("1100")?.isSystem, true);
    assert.equal(after.get("4200")?.name, "Delivery & Other Charges Income", "the old Other Income account is the charges income of v2");
    assert.ok(after.get("4400"), "Other Income is its own account now");
    for (const code of ["1350", "1450", "2150", "3900", "5200", "5300", "6710"]) {
      assert.ok(after.get(code), `${code} was added`);
    }
    // roles point at the existing rows
    const roles = await rolesOf(t.org.id);
    assert.equal(roles.get("AR")?.id, ids.get("1300"));
    assert.equal(roles.get("CASH")?.id, ids.get("1100"));
    assert.equal(roles.get("SALES")?.id, ids.get("4100"));
    assert.equal(roles.get("OTHER_INCOME")?.code, "4400");
    // what the owner added is left alone
    assert.deepEqual([after.get("1201")?.name, after.get("1201")?.isSystem, after.get("1201")?.kind], ["City Bank", false, "BANK"]);
    assert.deepEqual([after.get("6150")?.id, after.get("6150")?.name, after.get("6150")?.isSystem], [own.id, "Tea and snacks", false]);
    assert.equal(after.get("6100")?.isSystem, false, "an expense head is the owner's to rename or close");
    assert.equal(after.get("6100")?.name, "Rent");
  }, bare);
});

test("a role the owner has pointed at another account is not taken back", async () => {
  await withTestOrg(async (t) => {
    await ensureChart(prisma, t.org.id);
    const group = await prisma.accountGroup.findFirstOrThrow({ where: { organizationId: t.org.id, code: "1000" } });
    const mine = await prisma.account.create({ data: { organizationId: t.org.id, groupId: group.id, code: "1210", name: "My cash box", kind: "CASH" } });
    await prisma.accountRole.update({ where: { organizationId_role: { organizationId: t.org.id, role: "CASH" } }, data: { accountId: mine.id } });
    await ensureChart(prisma, t.org.id);
    assert.equal((await rolesOf(t.org.id)).get("CASH")?.id, mine.id);
  }, bare);
});

test("two organizations never share accounts or roles", async () => {
  await withTestOrg(async (a) => {
    await withTestOrg(async (b) => {
      await ensureChart(prisma, a.org.id);
      await ensureChart(prisma, b.org.id);
      const roleA = (await rolesOf(a.org.id)).get("AR");
      const roleB = (await rolesOf(b.org.id)).get("AR");
      assert.notEqual(roleA?.id, roleB?.id);
      assert.equal(roleA?.organizationId, a.org.id);
      assert.equal(roleB?.organizationId, b.org.id);
    }, bare);
  }, bare);
});

test("charts are made while other organizations are being cleaned up (a smoke test of the case that deadlocked)", async () => {
  // The whole suite runs files in parallel: one file makes an organization (and its chart) while another file deletes its
  // own. Deleting an account checks the roles that point at it, which takes locks on the role index; a chart written as one
  // multi-row INSERT holds its first rows while it waits for the rest, and the two met in a deadlock (N21 again). This
  // test alone does not reproduce it reliably; the proof is the parallel full-suite runs recorded with the commit.
  const { testOrg, concurrentlySettled } = await import("../../tests/helpers/index.ts");
  type Made = Awaited<ReturnType<typeof testOrg>>;
  const failures: string[] = [];
  const left: Made[] = [];
  let doomed: Made[] = [];
  for (let round = 0; round < 2; round += 1) {
    const old = await Promise.all(Array.from({ length: 8 }, () => testOrg()));
    doomed = old;
    const results = await concurrentlySettled(16, async (index) => {
      if (index < 8) {
        return old[index].cleanup();
      }
      const made = await testOrg({ chart: false });
      left.push(made);
      await ensureChart(prisma, made.org.id);
    });
    for (const result of results) {
      if (result.status === "rejected") {
        failures.push(`${(result.reason as { code?: string }).code}: ${String((result.reason as Error).message).split("\n").pop()}`);
      }
    }
  }
  await Promise.all([...left, ...doomed].map((made) => made.cleanup()));
  assert.deepEqual(failures, []);
});
