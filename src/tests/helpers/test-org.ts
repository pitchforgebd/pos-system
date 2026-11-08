import "./env.ts";

import { randomUUID } from "node:crypto";

import type { Branch, Organization, Role, User, Warehouse } from "@prisma/client";

import { accountGroups, accounts } from "../../../prisma/chart-of-accounts.ts";
import { prisma } from "../../lib/db/client.ts";
import { permissionCodes } from "../../lib/permissions/codes.ts";
import { hashPassword } from "../../modules/auth/password.ts";
import { cleanupOrg } from "./cleanup.ts";

/** The password of every owner this harness creates. */
export const TEST_PASSWORD = "correct-password";

export type TestOrgOptions = {
  /** "all" (default) gives the owner role every permission; a list gives only those. */
  permissions?: "all" | readonly string[];
  /** Seed the chart of accounts (default true). */
  chart?: boolean;
};

export type TestOrg = {
  org: Organization;
  branch: Branch;
  warehouse: Warehouse;
  owner: User;
  role: Role;
  /** The actor shape the posting modules take. */
  actor: { organizationId: string; branchId: string; userId: string; warehouseId: string; ip: string; userAgent: string };
  /** Deletes the organization and everything in it. Safe to call twice. */
  cleanup: () => Promise<void>;
};

let catalog: Promise<void> | null = null;
let passwordHash: Promise<string> | null = null;

/** The permission catalog is global and only `prisma db seed` fills it, so make sure it is there. */
function ensurePermissionCatalog() {
  catalog ??= (async () => {
    const have = new Set(
      (await prisma.permission.findMany({ where: { code: { in: [...permissionCodes] } }, select: { code: true } })).map((row) => row.code),
    );
    // One statement per code, each on its own (autocommit), always in the same order. A single multi-row
    // INSERT IGNORE into an empty table takes gap locks on the unique index, and two test files doing that at
    // the same moment deadlock (N21). One row at a time holds one lock for an instant, so no cycle can form;
    // ON DUPLICATE KEY UPDATE makes "another file got there first" a no-op instead of an error.
    const missing = permissionCodes.filter((code) => !have.has(code)).sort();
    for (const code of missing) {
      await prisma.$executeRaw`
        INSERT INTO permissions (id, code, module, updatedAt)
        VALUES (${randomUUID()}, ${code}, ${code.split(".")[0] ?? code}, NOW(3))
        ON DUPLICATE KEY UPDATE code = code
      `;
    }
  })().catch((error: unknown) => {
    catalog = null;
    throw error;
  });
  return catalog;
}

/** An empty organization with a branch, a warehouse, an owner user, the owner role and the chart of accounts. */
export async function testOrg(options: TestOrgOptions = {}): Promise<TestOrg> {
  await ensurePermissionCatalog();
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const org = await prisma.organization.create({ data: { name: `Test ${tag}`, slug: `t-${tag}` } });
  const cleanup = once(() => cleanupOrg(org.id));
  try {
    const granted = options.permissions === undefined || options.permissions === "all" ? [...permissionCodes] : [...options.permissions];
    const permissions = await prisma.permission.findMany({ where: { code: { in: granted } }, select: { id: true } });
    if (permissions.length !== new Set(granted).size) {
      throw new Error("testOrg: an unknown permission code was requested");
    }

    const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
    const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, branchId: branch.id, name: "Main" } });
    const role = await prisma.role.create({
      data: { organizationId: org.id, name: options.permissions === undefined || options.permissions === "all" ? "Super Admin" : "Limited owner" },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ organizationId: org.id, roleId: role.id, permissionId: permission.id })),
    });
    const owner = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Owner",
        email: `owner-${tag}@example.test`,
        passwordHash: await (passwordHash ??= hashPassword(TEST_PASSWORD)),
        roles: { create: { organizationId: org.id, roleId: role.id } },
        branchAccess: { create: { organizationId: org.id, branchId: branch.id } },
      },
    });

    if (options.chart !== false) {
      for (const group of accountGroups) {
        await prisma.accountGroup.create({ data: { organizationId: org.id, code: group.code, name: group.name } });
      }
      const groups = await prisma.accountGroup.findMany({ where: { organizationId: org.id } });
      const groupIdByCode = new Map(groups.map((group) => [group.code, group.id]));
      await prisma.account.createMany({
        data: accounts.map((account) => ({
          organizationId: org.id,
          groupId: groupIdByCode.get(account.groupCode) as string,
          code: account.code,
          name: account.name,
        })),
      });
    }

    return {
      org,
      branch,
      warehouse,
      owner,
      role,
      actor: { organizationId: org.id, branchId: branch.id, userId: owner.id, warehouseId: warehouse.id, ip: "127.0.0.1", userAgent: "test" },
      cleanup,
    };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}

/** Runs `fn` with a fresh organization and always cleans it up, also when `fn` throws. */
export async function withTestOrg<T>(fn: (t: TestOrg) => Promise<T>, options: TestOrgOptions = {}): Promise<T> {
  const t = await testOrg(options);
  try {
    return await fn(t);
  } finally {
    await t.cleanup();
  }
}

function once(fn: () => Promise<void>) {
  let running: Promise<void> | null = null;
  return () => (running ??= fn());
}
