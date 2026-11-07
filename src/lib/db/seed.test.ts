import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Runs the real `prisma db seed` command against a throwaway database named <database>_seedtest:
// migrate deploy on an empty database, then the seed, exactly as a first install does.
// The throwaway database is created and dropped here; the name is checked before every DROP.

try {
  for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  }
} catch {
  // DATABASE_URL may come from the environment instead.
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { prisma: { seed: string } };

function scratchDatabase(adminUrl: string) {
  const url = new URL(adminUrl);
  const base = url.pathname.slice(1);
  assert.match(base, /^[A-Za-z0-9_]+$/, "DATABASE_URL must name a database");
  const name = `${base}_seedtest`;
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
}

function assertScratchName(name: string) {
  assert.match(name, /^[A-Za-z0-9_]+_seedtest$/, `refusing to drop ${name}: not a _seedtest database`);
}

function run(args: string[], env: Record<string, string | undefined>) {
  const merged: Record<string, string | undefined> = { ...process.env, ...env };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) {
      delete merged[key];
    }
  }
  return spawnSync(process.execPath, args, { cwd: root, env: merged, encoding: "utf8" });
}

test("the seed on an empty database adds no demo data, keeps custom grants, and runs on an https configuration", async () => {
  const adminUrl = process.env.DATABASE_URL;
  assert.ok(adminUrl, "DATABASE_URL is not set");
  const { name, url } = scratchDatabase(adminUrl);
  const { prisma: admin } = await import("./client.ts");
  const { permissionCodes } = await import("../permissions/codes.ts");
  const { PrismaClient } = await import("@prisma/client");

  assert.match(pkg.prisma.seed, /^node /);
  const seedArgs = pkg.prisma.seed.split(/\s+/).slice(1);
  // A production-like environment: https APP_URL and NODE_ENV=production must not stop the seed.
  const seed = (extra: Record<string, string | undefined> = {}) =>
    run(seedArgs, {
      DATABASE_URL: url,
      APP_URL: "https://shop.example.com",
      NODE_ENV: "production",
      BCRYPT_COST: "4",
      SEED_OWNER_EMAIL: "owner@example.com",
      SEED_OWNER_PASSWORD: "seed-test-password",
      SEED_DEMO: undefined,
      ...extra,
    });

  assertScratchName(name);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\``);
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const migrated = run([prismaCli, "migrate", "deploy"], { DATABASE_URL: url });
    assert.equal(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.equal(await db.permission.count(), 0, "a migrated database must start without permissions");

    // First install: no demo data, the whole permission catalog, Super Admin holds every permission.
    const first = seed();
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const catalog = permissionCodes.length;
    assert.equal(await db.permission.count(), catalog);
    const org = await db.organization.findUniqueOrThrow({ where: { slug: "meridian" } });
    assert.equal((await db.account.count({ where: { organizationId: org.id } })) > 0, true);
    assert.equal(await db.product.count(), 0);
    assert.equal(await db.customer.count(), 0);
    assert.equal(await db.sale.count(), 0);
    assert.equal(await db.product.count({ where: { sku: { startsWith: "DEMO-" } } }), 0);
    const superAdmin = await db.role.findFirstOrThrow({ where: { organizationId: org.id, name: "Super Admin" } });
    const adminRole = await db.role.findFirstOrThrow({ where: { organizationId: org.id, name: "Admin" } });
    assert.equal(await db.rolePermission.count({ where: { roleId: superAdmin.id } }), catalog);

    // A second seed adds what is missing and removes nothing.
    const custom = await db.permission.create({ data: { code: "custom.test", module: "custom" } });
    for (const roleId of [superAdmin.id, adminRole.id]) {
      await db.rolePermission.create({ data: { organizationId: org.id, roleId, permissionId: custom.id } });
    }
    const missing = await db.rolePermission.findFirstOrThrow({
      where: { roleId: superAdmin.id, permissionId: { not: custom.id } },
    });
    await db.rolePermission.delete({ where: { id: missing.id } });
    const adminGrants = await db.rolePermission.count({ where: { roleId: adminRole.id } });
    // Existing grant rows must be left alone. Deleting every grant and creating them again ends in the
    // same state but leaves a moment with no permissions (and a lock-out if the second step fails),
    // and it gives the rows new ids, which is what is checked here.
    const keptSuperAdminGrant = await db.rolePermission.findFirstOrThrow({
      where: { roleId: superAdmin.id, permissionId: { notIn: [custom.id, missing.permissionId] } },
    });
    const keptAdminGrant = await db.rolePermission.findFirstOrThrow({
      where: { roleId: adminRole.id, permissionId: { not: custom.id } },
    });

    const second = seed();
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    for (const kept of [keptSuperAdminGrant, keptAdminGrant]) {
      assert.notEqual(
        await db.rolePermission.findUnique({ where: { id: kept.id } }),
        null,
        "an existing grant was deleted and created again",
      );
    }
    assert.equal(await db.organization.count(), 1);
    assert.equal(await db.permission.count(), catalog + 1);
    assert.equal(await db.rolePermission.count({ where: { roleId: superAdmin.id, permissionId: custom.id } }), 1);
    assert.equal(await db.rolePermission.count({ where: { roleId: adminRole.id, permissionId: custom.id } }), 1);
    assert.equal(await db.rolePermission.count({ where: { roleId: adminRole.id } }), adminGrants);
    assert.equal(
      await db.rolePermission.count({ where: { roleId: superAdmin.id, permissionId: missing.permissionId } }),
      1,
      "a removed standard grant is added back",
    );
    assert.equal(await db.rolePermission.count({ where: { roleId: superAdmin.id } }), catalog + 1);
    assert.equal(await db.product.count(), 0);

    // Control: with SEED_DEMO=1 the same command does add demo data, so the checks above can fail.
    const demo = seed({ SEED_DEMO: "1" });
    assert.equal(demo.status, 0, `${demo.stdout}\n${demo.stderr}`);
    assert.equal((await db.product.count({ where: { sku: { startsWith: "DEMO-" } } })) > 0, true);
    assert.equal(await db.rolePermission.count({ where: { roleId: superAdmin.id } }), catalog + 1);
  } finally {
    await db.$disconnect();
    assertScratchName(name);
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``);
  }
});
