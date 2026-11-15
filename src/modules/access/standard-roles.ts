import type { PrismaClient } from "@prisma/client";

import { permissionCodes, type PermissionCode } from "../../lib/permissions/codes.ts";

// The roles a shop starts with (P12 task 11, LV-5), so the owner gives each person a role instead of building one from sixty-odd permission codes.
// Super Admin (the owner: every permission, creates branches) and Admin are made by the seed as before; these four are added. The lists are in
// docs/PERMISSIONS.md. A role is filled only when it has no permission yet, so a shop's own changes to it are never undone by a later seed.

export type StandardRole = { name: string; note: string; permissions: readonly PermissionCode[] };

const every = (except: readonly PermissionCode[]): PermissionCode[] => permissionCodes.filter((code) => !except.includes(code));

export const STANDARD_ROLES: readonly StandardRole[] = [
  {
    name: "Manager",
    note: "Runs the shop day to day: sales, stock, purchases, money and reports. Cannot manage users, roles, branches or settings, close a year or post into a locked past.",
    permissions: every(["roles.manage", "branches.manage", "settings.manage", "users.create", "users.edit", "users.disable", "period.close", "posting.backdate", "accounting.reverse"]),
  },
  {
    name: "Cashier",
    note: "The register: sells, takes money from customers, opens and closes a shift. Sees no cost price, no profit and no reports, gives no discount and changes no price.",
    permissions: ["dashboard.view", "products.view", "sales.view", "sales.create", "customers.view", "customers.create", "customers.payment", "orders.view", "orders.create", "shifts.manage"],
  },
  {
    name: "Store keeper",
    note: "The store: receives purchases, counts and adjusts stock, moves stock between places, records damage and expiry, dispatches orders. Sees no profit and takes no money.",
    permissions: [
      "dashboard.view",
      "products.view",
      "products.create",
      "products.edit",
      "inventory.view",
      "inventory.adjust",
      "inventory.transfer",
      "inventory.damage",
      "inventory.expiry",
      "inventory.opening",
      "purchase.view",
      "purchase.create",
      "suppliers.view",
      "orders.view",
      "orders.manage",
      "shipments.view",
      "shipments.manage",
      "requisitions.manage",
    ],
  },
  {
    name: "Accountant",
    note: "The books: accounting entries, vendor and customer payments, every report including profit and cost, the audit log. Does not sell, does not close a year or post into a locked past.",
    permissions: [
      "dashboard.view",
      "products.view",
      "products.cost",
      "sales.view",
      "purchase.view",
      "customers.view",
      "customers.payment",
      "customers.advance",
      "suppliers.view",
      "suppliers.payment",
      "inventory.view",
      "accounting.view",
      "accounting.create",
      "accounting.post",
      "accounting.reverse",
      "expenses.accrue",
      "couriers.settle",
      "shipments.view",
      "reports.view",
      "reports.export",
      "reports.profit",
      "reports.all_branches",
      "audit.view",
    ],
  },
];

/** Makes the standard roles of one shop. Each is created when missing and given its permissions only when it has none; nothing is ever removed. */
export async function ensureStandardRoles(db: PrismaClient, organizationId: string) {
  const catalog = new Map((await db.permission.findMany({ select: { id: true, code: true } })).map((row) => [row.code, row.id]));
  const made: string[] = [];
  for (const standard of STANDARD_ROLES) {
    const role = await db.role.upsert({
      where: { organizationId_name: { organizationId, name: standard.name } },
      update: {},
      create: { organizationId, name: standard.name, note: standard.note },
    });
    if ((await db.rolePermission.count({ where: { roleId: role.id } })) > 0) {
      continue;
    }
    const data = standard.permissions.flatMap((code) => {
      const permissionId = catalog.get(code);
      return permissionId ? [{ organizationId, roleId: role.id, permissionId }] : [];
    });
    await db.rolePermission.createMany({ data, skipDuplicates: true });
    made.push(standard.name);
  }
  return made;
}
