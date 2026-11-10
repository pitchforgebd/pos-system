import { Prisma } from "@prisma/client";

import { accountGroups, accounts as chart } from "../../../prisma/chart-of-accounts.ts";

type Db = Prisma.TransactionClient;

/**
 * Inserts the rows one at a time, and a row that is already there is skipped. One INSERT with many rows (or INSERT IGNORE)
 * keeps the locks of the rows it has written while it waits for the next one; another transaction that deletes an account
 * (it checks the roles pointing at it) holds locks the insert then waits for, and the two deadlock (N21). A statement per
 * row holds nothing while it waits, so no cycle can form.
 */
async function insertEach<T>(rows: readonly T[], insert: (row: T) => Promise<unknown>) {
  for (const row of rows) {
    try {
      await insert(row);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }
  }
}

/**
 * Makes an organization's chart of accounts the v2 chart (02_ACCOUNTING_MODEL.md section 1): the groups and accounts it
 * lacks are added, the accounts it already has are kept (same row, so journal lines still point at them) and told what
 * they are (kind, system flag, the roles they play). It is safe to run again and again, and it is the one way an
 * organization gets its chart: a new organization, the seed, and an older database being brought up to date.
 *
 * What it does not do: undo the owner. An account the owner added is left alone, an account the owner renamed keeps the
 * name (only the names the first version of the chart used are replaced), and a role the owner pointed at another
 * account stays there.
 */
export async function ensureChart(db: Db, organizationId: string) {
  const haveGroups = await db.accountGroup.findMany({ where: { organizationId }, select: { code: true } });
  const groupCodes = new Set(haveGroups.map((group) => group.code));
  const missingGroups = accountGroups.filter((group) => !groupCodes.has(group.code));
  await insertEach(missingGroups, (group) => db.accountGroup.create({ data: { organizationId, code: group.code, name: group.name } }));
  const groupId = new Map((await db.accountGroup.findMany({ where: { organizationId }, select: { id: true, code: true } })).map((group) => [group.code, group.id]));

  const have = new Map((await db.account.findMany({ where: { organizationId } })).map((account) => [account.code, account]));
  const toCreate = chart.filter((wanted) => !have.has(wanted.code));
  await insertEach(toCreate, (wanted) =>
    db.account.create({
      data: {
        organizationId,
        groupId: groupId.get(wanted.groupCode) as string,
        code: wanted.code,
        name: wanted.name,
        kind: wanted.kind ?? "OTHER",
        isSystem: wanted.role !== undefined,
      },
    }),
  );

  // Accounts that already existed (the first chart): tell them what they are.
  for (const wanted of chart) {
    const row = have.get(wanted.code);
    if (!row) {
      continue;
    }
    const data: Prisma.AccountUpdateInput = {};
    if (wanted.role !== undefined && !row.isSystem) {
      data.isSystem = true;
    }
    if (wanted.kind !== undefined && row.kind === "OTHER") {
      data.kind = wanted.kind;
    }
    if (wanted.oldNames?.includes(row.name)) {
      data.name = wanted.name;
    }
    if (Object.keys(data).length > 0) {
      await db.account.update({ where: { id: row.id }, data });
    }
  }

  const accountId = new Map((await db.account.findMany({ where: { organizationId }, select: { id: true, code: true } })).map((account) => [account.code, account.id]));
  const haveRoles = new Set((await db.accountRole.findMany({ where: { organizationId }, select: { role: true } })).map((row) => row.role));
  const missingRoles = chart.flatMap((wanted) => (wanted.role !== undefined && !haveRoles.has(wanted.role) ? [{ organizationId, role: wanted.role, accountId: accountId.get(wanted.code) as string }] : []));
  await insertEach(missingRoles, (row) => db.accountRole.create({ data: row }));
}
