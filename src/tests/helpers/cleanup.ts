import "./env.ts";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db/client.ts";

export type OrgTablePlan = {
  /** Tables that have an organizationId column, in a safe delete order: a table comes before every table it references. */
  order: string[];
  /** Tables that reference themselves: table -> columns. */
  selfReference: Map<string, string[]>;
};

// READ COMMITTED on purpose. `DELETE ... WHERE organizationId = ?` often scans a whole small table, and under
// REPEATABLE READ (the MySQL default) that locks every row and gap it passes. A posting that another test runs
// at the same moment then deadlocks with it (P2034). READ COMMITTED locks only the rows that match.
const ISOLATION = Prisma.TransactionIsolationLevel.ReadCommitted;

let planned: Promise<OrgTablePlan> | null = null;

/** Reads the tables and foreign keys from the database once per process, so new tables are covered without edits. */
export function orgTablePlan() {
  planned ??= buildPlan().catch((error: unknown) => {
    planned = null;
    throw error;
  });
  return planned;
}

function assertName(name: string) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`unexpected table or column name: ${name}`);
  }
}

async function buildPlan(): Promise<OrgTablePlan> {
  const scopedRows = await prisma.$queryRawUnsafe<{ t: string }[]>(
    "SELECT DISTINCT c.table_name AS t FROM information_schema.columns c " +
      "JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE' " +
      "WHERE c.table_schema = DATABASE() AND c.column_name = 'organizationId' ORDER BY 1",
  );
  const keys = await prisma.$queryRawUnsafe<{ child: string; parent: string; col: string }[]>(
    "SELECT table_name AS child, referenced_table_name AS parent, column_name AS col FROM information_schema.key_column_usage " +
      "WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL",
  );
  const tables = new Set(scopedRows.map((row) => row.t));
  for (const name of tables) {
    assertName(name);
  }

  // A table that points at an organization table but has no organizationId cannot be cleaned by organization.
  for (const key of keys) {
    if (tables.has(key.parent) && !tables.has(key.child)) {
      throw new Error(`${key.child} references ${key.parent} but has no organizationId column; the test cleanup cannot scope it`);
    }
  }

  const selfReference = new Map<string, string[]>();
  const parentsOf = new Map<string, Set<string>>();
  const childCount = new Map<string, number>([...tables].map((name) => [name, 0]));
  for (const key of keys) {
    if (!tables.has(key.child) || !tables.has(key.parent)) {
      continue;
    }
    if (key.child === key.parent) {
      assertName(key.col);
      selfReference.set(key.child, [...(selfReference.get(key.child) ?? []), key.col]);
      continue;
    }
    const parents = parentsOf.get(key.child) ?? new Set<string>();
    if (!parents.has(key.parent)) {
      parents.add(key.parent);
      parentsOf.set(key.child, parents);
      childCount.set(key.parent, (childCount.get(key.parent) ?? 0) + 1);
    }
  }

  const order: string[] = [];
  const ready = [...tables].filter((name) => childCount.get(name) === 0);
  while (ready.length > 0) {
    const name = ready.shift() as string;
    order.push(name);
    for (const parent of parentsOf.get(name) ?? []) {
      const left = (childCount.get(parent) ?? 0) - 1;
      childCount.set(parent, left);
      if (left === 0) {
        ready.push(parent);
      }
    }
  }
  if (order.length !== tables.size) {
    const stuck = [...tables].filter((name) => !order.includes(name));
    throw new Error(`foreign keys between organization tables form a cycle: ${stuck.join(", ")}`);
  }
  return { order, selfReference };
}

/** Deletes an organization and every row that belongs to it. Safe to call twice. */
export async function cleanupOrg(organizationId: string) {
  const plan = await orgTablePlan();
  await prisma.$transaction(
    async (tx) => {
      for (const [table, columns] of plan.selfReference) {
        for (const column of columns) {
          await tx.$executeRawUnsafe(
            `UPDATE \`${table}\` SET \`${column}\` = NULL WHERE organizationId = ? AND \`${column}\` IS NOT NULL`,
            organizationId,
          );
        }
      }
      for (const table of plan.order) {
        await tx.$executeRawUnsafe(`DELETE FROM \`${table}\` WHERE organizationId = ?`, organizationId);
      }
      await tx.$executeRawUnsafe("DELETE FROM `organizations` WHERE id = ?", organizationId);
    },
    { isolationLevel: ISOLATION, maxWait: 20_000, timeout: 120_000 },
  );
}

/** Rows that still belong to an organization, by table. An empty object means nothing is left. */
export async function countOrgRows(organizationId: string) {
  const plan = await orgTablePlan();
  const left: Record<string, number> = {};
  for (const table of plan.order) {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE organizationId = ?`,
      organizationId,
    );
    const count = Number(rows[0]?.n ?? 0);
    if (count > 0) {
      left[table] = count;
    }
  }
  const orgRows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    "SELECT COUNT(*) AS n FROM `organizations` WHERE id = ?",
    organizationId,
  );
  if (Number(orgRows[0]?.n ?? 0) > 0) {
    left.organizations = Number(orgRows[0]?.n ?? 0);
  }
  return left;
}
