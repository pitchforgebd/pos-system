import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { GET as listProductsRoute } from "../../app/api/v1/products/route.ts";
import { GET as runReport } from "../../app/api/v1/reports/run/[key]/route.ts";
import { GET as listAuditRoute } from "../../app/api/v1/users/route.ts";
import { prisma } from "../../lib/db/client.ts";
import { permissionCodes } from "../../lib/permissions/codes.ts";
import { hashPassword } from "../auth/password.ts";
import { openSession } from "../auth/session.ts";
import { withTestOrg } from "../../tests/helpers/index.ts";
import { ensureStandardRoles, STANDARD_ROLES } from "./standard-roles.ts";

// P12 task 11 (LV-5): the standard roles and what each may and may not do.

const codesOf = async (organizationId: string, name: string) =>
  new Set((await prisma.rolePermission.findMany({ where: { organizationId, role: { name } }, select: { permission: { select: { code: true } } } })).map((row) => row.permission.code));

test("the four standard roles are made once, with the permissions of the list, and a shop's own changes are never undone", async () => {
  await withTestOrg(async (t) => {
    assert.deepEqual((await ensureStandardRoles(prisma, t.org.id)).sort(), ["Accountant", "Cashier", "Manager", "Store keeper"]);
    for (const standard of STANDARD_ROLES) {
      assert.deepEqual([...(await codesOf(t.org.id, standard.name))].sort(), [...standard.permissions].sort(), standard.name);
      assert.ok(standard.permissions.every((code) => permissionCodes.includes(code)), `${standard.name} lists only real codes`);
    }
    // the owner role is not one of them, and keeps every permission
    assert.equal((await codesOf(t.org.id, "Super Admin")).size, permissionCodes.length);
    // a second run makes nothing; a permission the shop took away stays away
    await prisma.rolePermission.deleteMany({ where: { organizationId: t.org.id, role: { name: "Cashier" }, permission: { code: "customers.create" } } });
    assert.deepEqual(await ensureStandardRoles(prisma, t.org.id), []);
    assert.equal((await codesOf(t.org.id, "Cashier")).has("customers.create"), false);
  });
});

test("what each role may not do", async () => {
  await withTestOrg(async (t) => {
    await ensureStandardRoles(prisma, t.org.id);
    const cashier = await codesOf(t.org.id, "Cashier");
    for (const code of ["products.cost", "reports.view", "reports.profit", "reports.export", "sales.discount", "sales.price_override", "sales.price_level", "sales.cancel", "returns.without_invoice", "accounting.view", "inventory.adjust", "users.view", "roles.manage", "settings.manage", "audit.view", "period.close", "posting.backdate"]) {
      assert.equal(cashier.has(code), false, `a cashier does not have ${code}`);
    }
    for (const code of ["sales.create", "customers.payment", "shifts.manage"]) {
      assert.equal(cashier.has(code), true, `a cashier has ${code}`);
    }
    const manager = await codesOf(t.org.id, "Manager");
    for (const code of ["roles.manage", "branches.manage", "settings.manage", "users.create", "period.close", "posting.backdate"]) {
      assert.equal(manager.has(code), false, `a manager does not have ${code}`);
    }
    for (const code of ["reports.profit", "sales.discount", "products.cost", "couriers.approve_difference"]) {
      assert.equal(manager.has(code), true, `a manager has ${code}`);
    }
    const keeper = await codesOf(t.org.id, "Store keeper");
    for (const code of ["reports.profit", "products.cost", "accounting.view", "customers.payment", "sales.create", "period.close"]) {
      assert.equal(keeper.has(code), false, `a store keeper does not have ${code}`);
    }
    const accountant = await codesOf(t.org.id, "Accountant");
    for (const code of ["sales.create", "inventory.adjust", "roles.manage", "period.close", "posting.backdate"]) {
      assert.equal(accountant.has(code), false, `an accountant does not have ${code}`);
    }
    assert.equal(accountant.has("reports.profit"), true);
  });
});

test("a signed-in cashier is turned away from the reports and the users, and sees no cost price", async () => {
  await withTestOrg(async (t) => {
    await ensureStandardRoles(prisma, t.org.id);
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: t.org.id, name: "Cashier" } });
    const user = await prisma.user.create({
      data: {
        organizationId: t.org.id,
        name: "Counter",
        email: `counter-${Date.now()}@example.test`,
        passwordHash: await hashPassword("a-long-password-1"),
        roles: { create: { organizationId: t.org.id, roleId: role.id } },
        branchAccess: { create: { organizationId: t.org.id, branchId: t.branch.id } },
      },
    });
    await prisma.product.create({
      data: { organizationId: t.org.id, sku: `C-${Date.now()}`, liveSku: `C-${Date.now()}`, name: "Seed", slug: `seed-${Date.now()}`, purchasePrice: "40.00", sellingPrice: "50.00", wholesalePrice: "45.00", minimumPrice: "42.00", trackStock: true, trackExpiry: false, trackBatch: false, trackSerial: false },
    });
    const { token } = await openSession({ organizationId: t.org.id, userId: user.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
    const cookie = `meridian_session=${token}`;
    const get = (path: string) => new Request(`http://127.0.0.1${path}`, { headers: { cookie } });
    const context = { params: Promise.resolve({}) };

    const report = await runReport(get("/api/v1/reports/run/sales"), { params: Promise.resolve({ key: "sales" }) });
    assert.equal(report.status, 403, "no reports");
    const profit = await runReport(get("/api/v1/reports/run/profit"), { params: Promise.resolve({ key: "profit" }) });
    assert.equal(profit.status, 403, "no profit");
    assert.equal((await listAuditRoute(get("/api/v1/users"), context)).status, 403, "no users");
    const products = await listProductsRoute(get("/api/v1/products"), context);
    assert.equal(products.status, 200);
    const text = await products.text();
    assert.equal(text.includes("40.00"), false, "the purchase price is not in the answer");
    assert.equal(text.includes("\"purchasePrice\""), false);
  });
});
