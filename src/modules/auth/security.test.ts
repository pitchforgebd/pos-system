import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Prisma } from "@prisma/client";

for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}
process.env.AUTH_SECRET ??= "test-secret-phase-16-value";
process.env.BCRYPT_COST = "4";

test("phase 16 rejects cross-site, cross-branch, injection, and secret leakage", async () => {
  const { prisma } = await import("../../lib/db/client.ts");
  const { GET: health } = await import("../../app/api/health/route.ts");
  const { POST: loginRoute } = await import("../../app/api/v1/auth/login/route.ts");
  const { clientIp, jsonError, rejectCrossSite } = await import("../../lib/api/http.ts");
  const { securityHeaders } = await import("../../lib/security/headers.ts");
  const { safeImportName } = await import("../imports/files.ts");
  const { postBalancedJournal, PostingError } = await import("../accounting/post.ts");
  const { hashPassword } = await import("./password.ts");
  const { login } = await import("./login.ts");
  const { resetRateLimits } = await import("./rate-limit.ts");
  const { getSale } = await import("../sales/sales.ts");
  const { listProducts, getProduct } = await import("../catalog/products.ts");

  const headers = securityHeaders("https://shop.example");
  const header = (key: string) => headers.find((item) => item.key === key)?.value ?? "";
  assert.match(header("X-Content-Type-Options"), /nosniff/);
  assert.match(header("Content-Security-Policy"), /frame-ancestors 'none'/);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assert.doesNotMatch(securityHeaders("https://shop.example").find((item) => item.key === "Content-Security-Policy")?.value ?? "", /unsafe-eval/);
  process.env.NODE_ENV = "development";
  assert.match(securityHeaders("http://127.0.0.1:3000").find((item) => item.key === "Content-Security-Policy")?.value ?? "", /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  process.env.NODE_ENV = previousNodeEnv;
  assert.match(header("Referrer-Policy"), /strict-origin/);
  assert.match(header("Permissions-Policy"), /camera=\(\)/);
  assert.equal(header("Strict-Transport-Security").includes("max-age"), true);
  assert.equal(securityHeaders("http://127.0.0.1:3000").some((item) => item.key === "Strict-Transport-Security"), false);

  const foreign = rejectCrossSite(new Request("http://127.0.0.1/api/v1/auth/login", { headers: { origin: "https://evil.example" } }));
  assert.equal(foreign?.status, 403);
  const missing = rejectCrossSite(new Request("http://127.0.0.1/api/v1/auth/login"));
  assert.equal(missing?.status, 403);
  const bareLogin = await loginRoute(
    new Request("http://127.0.0.1/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ email: "nobody@example.com", password: "not-the-password" }),
    }),
  );
  assert.equal(bareLogin.status, 403);

  const previousProxy = process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY;
  const spoofed = new Request("http://127.0.0.1/api/v1/auth/login", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
  assert.equal(clientIp(spoofed), "unknown");
  process.env.TRUST_PROXY = "1";
  assert.equal(clientIp(spoofed), "5.6.7.8");
  if (previousProxy === undefined) {
    delete process.env.TRUST_PROXY;
  } else {
    process.env.TRUST_PROXY = previousProxy;
  }

  assert.equal(safeImportName("../../evil.exe"), null);
  assert.equal(safeImportName("folder/products.csv"), "products.csv");

  await assert.rejects(
    () =>
      postBalancedJournal({} as never, {
        organizationId: "org",
        branchId: "branch",
        businessDate: new Date("2026-10-01T00:00:00.000Z"),
        description: "unbalanced",
        createdById: "user",
        lines: [
          { accountCode: "1100", debit: new Prisma.Decimal("1.00"), credit: new Prisma.Decimal("0.00") },
          { accountCode: "4100", debit: new Prisma.Decimal("0.00"), credit: new Prisma.Decimal("2.00") },
        ],
      }),
    (error: unknown) => error instanceof PostingError && error.message === "The journal is not balanced.",
  );

  const healthy = await health();
  const healthText = await healthy.text();
  assert.equal(healthText.includes("mysql://"), false);
  assert.equal(healthText.includes("stack"), false);
  const errorBody = await jsonError("DATABASE_ERROR", "The service is unavailable.", 500).text();
  assert.equal(errorBody.includes("stack"), false);

  const stamp = Date.now().toString();
  const org = await prisma.organization.create({ data: { name: "Sec A", slug: `sec-a-${stamp}` } });
  const other = await prisma.organization.create({ data: { name: "Sec B", slug: `sec-b-${stamp}` } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, name: "Main" } });
  const elsewhere = await prisma.branch.create({ data: { organizationId: org.id, name: "Other" } });
  const password = "correct-password";
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Cashier",
      email: `sec-${stamp}@example.com`,
      passwordHash: await hashPassword(password),
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      sku: `SEC-${stamp}`,
      liveSku: `SEC-${stamp}`,
      name: "Secret tea",
      slug: `secret-${stamp}`,
      purchasePrice: "1.00",
      sellingPrice: "2.00",
      wholesalePrice: "1.50",
      minimumPrice: "1.00",
      trackStock: true,
      trackExpiry: false,
      trackBatch: false,
      trackSerial: false,
    },
  });
  const sale = await prisma.sale.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      status: "POSTED",
      total: "2.00",
      businessDate: new Date("2026-10-01T00:00:00.000Z"),
    },
  });

  try {
    resetRateLimits();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await login({ email: `missing-${stamp}@example.com`, password, ip: "203.0.113.8", userAgent: "test" });
      assert.equal(failed.ok, false);
      if (!failed.ok) {
        assert.equal(failed.status, 401);
      }
    }
    const limited = await login({ email: `missing-${stamp}@example.com`, password, ip: "203.0.113.8", userAgent: "test" });
    assert.equal(limited.ok, false);
    if (!limited.ok) {
      assert.equal(limited.status, 429);
    }

    resetRateLimits();
    const signed = await loginRoute(
      new Request("http://127.0.0.1/api/v1/auth/login", {
        method: "POST",
        headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, password }),
      }),
    );
    const cookie = signed.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(cookie.includes(password), false);

    const failedAudit = await prisma.auditLog.findFirst({
      where: { action: "failed_login", userId: null },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(JSON.stringify(failedAudit ?? {}).includes(password), false);

    const injected = await listProducts(org.id, "' OR 1=1 --");
    assert.equal(injected.some((row) => row.id === product.id), false);
    assert.equal(await getProduct(other.id, product.id), null);
    assert.equal(await getSale(org.id, elsewhere.id, sale.id), null);
    assert.ok(await getSale(org.id, branch.id, sale.id));
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.auditLog.deleteMany({ where: { action: "failed_login", ip: "203.0.113.8", userAgent: "test" } });
    await prisma.session.deleteMany({ where: { organizationId: org.id } });
    await prisma.sale.deleteMany({ where: { organizationId: org.id } });
    await prisma.product.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.branch.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, other.id] } } });
    await prisma.$disconnect();
  }
});
