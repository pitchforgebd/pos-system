import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}
process.env.AUTH_SECRET ??= "test-secret-phase-04-value";
process.env.BCRYPT_COST = "4";

function originRequest(url: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", "http://localhost");
  if (init.cookie) {
    headers.set("cookie", init.cookie);
  }
  return new Request(url, { ...init, headers });
}

test("phase 04 access controls", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { hashPassword } = await import("./password.ts");
  const { resetRateLimits } = await import("./rate-limit.ts");
  const { decidePageAccess } = await import("../access/route-access.ts");
  const { POST: login } = await import("../../app/api/v1/auth/login/route.ts");
  const { GET: listUsers, POST: createUsers } = await import("../../app/api/v1/users/route.ts");
  const { GET: getUser } = await import("../../app/api/v1/users/[id]/route.ts");
  const { POST: selectBranch } = await import("../../app/api/v1/session/branch/route.ts");
  const { requestPasswordReset, resetPassword } = await import("./password-reset.ts");

  const stamp = Date.now().toString();
  const orgA = await prisma.organization.create({ data: { name: "Auth A", slug: `auth-a-${stamp}` } });
  const orgB = await prisma.organization.create({ data: { name: "Auth B", slug: `auth-b-${stamp}` } });
  const branchA = await prisma.branch.create({ data: { organizationId: orgA.id, name: "Granted" } });
  const branchDenied = await prisma.branch.create({ data: { organizationId: orgA.id, name: "Ungranted" } });
  const branchB = await prisma.branch.create({ data: { organizationId: orgB.id, name: "Other" } });
  // The permission catalog is global and only `prisma db seed` fills it. Create what this test
  // needs so it also runs on an empty database (CI runs migrations only, no seed).
  const sales = await prisma.permission.upsert({
    where: { code: "sales.view" },
    update: {},
    create: { code: "sales.view", module: "sales" },
  });
  const usersView = await prisma.permission.upsert({
    where: { code: "users.view" },
    update: {},
    create: { code: "users.view", module: "users" },
  });
  const roleA = await prisma.role.create({ data: { organizationId: orgA.id, name: "Cashier" } });
  await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: roleA.id, permissionId: sales.id } });
  const ownerRole = await prisma.role.create({ data: { organizationId: orgA.id, name: "Owner test" } });
  await prisma.rolePermission.create({ data: { organizationId: orgA.id, roleId: ownerRole.id, permissionId: usersView.id } });
  const passwordHash = await hashPassword("correct-password");
  const cashier = await prisma.user.create({
    data: {
      organizationId: orgA.id,
      name: "Cashier",
      email: `cashier-${stamp}@example.com`,
      passwordHash,
      roles: { create: { organizationId: orgA.id, roleId: roleA.id } },
      branchAccess: { create: { organizationId: orgA.id, branchId: branchA.id } },
    },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId: orgA.id,
      name: "Owner",
      email: `owner-${stamp}@example.com`,
      passwordHash,
      roles: { create: { organizationId: orgA.id, roleId: ownerRole.id } },
      branchAccess: { create: { organizationId: orgA.id, branchId: branchA.id } },
    },
  });
  const outsider = await prisma.user.create({
    data: { organizationId: orgB.id, name: "Outsider", email: `out-${stamp}@example.com`, passwordHash },
  });
  const disabled = await prisma.user.create({
    data: { organizationId: orgA.id, name: "Disabled", email: `disabled-${stamp}@example.com`, passwordHash, status: "DISABLED" },
  });

  async function signIn(email: string) {
    resetRateLimits();
    const response = await login(
      originRequest("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "correct-password" }),
      }),
    );
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    return { response, cookie };
  }

  try {
    resetRateLimits();
    const wrong = await login(
      originRequest("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: cashier.email, password: "wrong-password" }),
      }),
    );
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("set-cookie"), null);

    const missing = await listUsers(originRequest("http://localhost/api/v1/users"));
    assert.equal(missing.status, 401);

    const disabledLogin = await signIn(disabled.email);
    assert.equal(disabledLogin.response.status, 401);

    const cashierLogin = await signIn(cashier.email);
    assert.equal(cashierLogin.response.status, 200);
    const forbiddenUsers = await listUsers(originRequest("http://localhost/api/v1/users", { cookie: cashierLogin.cookie }));
    assert.equal(forbiddenUsers.status, 403);

    const ownerLogin = await signIn(owner.email);
    const hidden = await getUser(originRequest("http://localhost/api/v1/users/" + outsider.id, { cookie: ownerLogin.cookie }), {
      params: Promise.resolve({ id: outsider.id }),
    });
    assert.equal(hidden.status, 404);

    const otherBranch = await selectBranch(
      originRequest("http://localhost/api/v1/session/branch", {
        method: "POST",
        cookie: cashierLogin.cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branchId: branchB.id }),
      }),
    );
    assert.equal(otherBranch.status, 404);
    const ungranted = await selectBranch(
      originRequest("http://localhost/api/v1/session/branch", {
        method: "POST",
        cookie: cashierLogin.cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branchId: branchDenied.id }),
      }),
    );
    assert.equal(ungranted.status, 403);

    assert.equal(decidePageAccess("/users", new Set(["sales.view"])), "forbidden");
    assert.equal(decidePageAccess("/sms", new Set(["sales.view", "dashboard.view"])), "forbidden");
    assert.equal(decidePageAccess("/dashboard", null), "login");

    const created = await createUsers(
      originRequest("http://localhost/api/v1/users", {
        method: "POST",
        cookie: cashierLogin.cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Nope", email: `nope-${stamp}@example.com`, password: "correct-password" }),
      }),
    );
    assert.equal(created.status, 403);

    const reset = await requestPasswordReset({ email: cashier.email, ip: "127.0.0.1", userAgent: "test" });
    assert.equal(reset.ok, true);
    assert.ok(reset.token);
    const changed = await resetPassword({ token: reset.token, password: "new-password-1", ip: "127.0.0.1", userAgent: "test" });
    assert.equal(changed.ok, true);
    const reused = await resetPassword({ token: reset.token, password: "new-password-2", ip: "127.0.0.1", userAgent: "test" });
    assert.equal(reused.ok, false);
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.passwordReset.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.session.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.userRole.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.rolePermission.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.userBranchAccess.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.role.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.branch.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await prisma.$disconnect();
  }
});
