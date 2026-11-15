import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { deviceLabel } from "../../lib/format/device.ts";
import { TEST_PASSWORD, withTestOrg } from "../../tests/helpers/index.ts";
import { POST as localeRoute } from "../../app/api/v1/locale/route.ts";
import { AUDIT_PAGE_SIZE, searchAuditLogs, writeAudit } from "./audit.ts";
import { changePassword } from "./change-password.ts";
import { loadSession, openSession } from "./session.ts";
import { getSecuritySettings, setIdleTimeout } from "../settings/security.ts";

// P12: the idle timeout (N20), changing one's own password (U10) and the audit log page's search (L12, LV-4), and the language cookie (L9).

const ip = () => `192.0.2.${1 + Math.floor(Math.random() * 250)}`;

async function aSession(t: { org: { id: string }; owner: { id: string }; branch: { id: string } }) {
  const opened = await openSession({ organizationId: t.org.id, userId: t.owner.id, branchId: t.branch.id, ip: "127.0.0.1", userAgent: "test" });
  return opened.token;
}

test("a session nobody uses for the idle time is over, a used one is kept alive, the 12 hours stay", async () => {
  await withTestOrg(async (t) => {
    assert.equal((await getSecuritySettings(t.org.id)).idleTimeoutMinutes, 30, "the default is 30 minutes");
    const token = await aSession(t);
    assert.ok(await loadSession(token), "a fresh session works");
    const row = () => prisma.session.findFirstOrThrow({ where: { userId: t.owner.id, organizationId: t.org.id }, orderBy: { createdAt: "desc" } });
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

    // quiet for 10 minutes: still in, and the time it was last seen moves forward
    await prisma.session.update({ where: { id: (await row()).id }, data: { lastSeenAt: minutesAgo(10) } });
    assert.ok(await loadSession(token));
    assert.ok(Date.now() - (await row()).lastSeenAt.getTime() < 60 * 1000, "lastSeenAt was brought up to date");

    // quiet for 31 minutes: over, and revoked for good
    await prisma.session.update({ where: { id: (await row()).id }, data: { lastSeenAt: minutesAgo(31) } });
    assert.equal(await loadSession(token), null);
    assert.ok((await row()).revokedAt, "the idle session is revoked");
    assert.equal(await loadSession(token), null, "and stays over even if used again");

    // the shop sets its own idle time
    await setIdleTimeout({ organizationId: t.org.id, userId: t.owner.id, ip: "127.0.0.1", userAgent: "test" }, 5);
    const second = await aSession(t);
    await prisma.session.updateMany({ where: { userId: t.owner.id, revokedAt: null }, data: { lastSeenAt: minutesAgo(6) } });
    assert.equal(await loadSession(second), null, "6 minutes quiet is too long when the shop says 5");
    await setIdleTimeout({ organizationId: t.org.id, userId: t.owner.id, ip: "127.0.0.1", userAgent: "test" }, 60);
    const third = await aSession(t);
    await prisma.session.updateMany({ where: { userId: t.owner.id, revokedAt: null }, data: { lastSeenAt: minutesAgo(45) } });
    assert.ok(await loadSession(third), "45 minutes quiet is fine when the shop says 60");
    // the absolute 12 hours still end a busy session
    await prisma.session.updateMany({ where: { userId: t.owner.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000), lastSeenAt: new Date() } });
    assert.equal(await loadSession(third), null);
    assert.ok(await prisma.auditLog.findFirst({ where: { organizationId: t.org.id, action: "idle-timeout" } }), "the change is in the audit log");
  });
});

test("changing the password: the old one is needed, the rules apply, every other session of the user ends, a wrong old password counts", async () => {
  await withTestOrg(async (t) => {
    const here = await aSession(t);
    const elsewhere = await aSession(t);
    const current = await prisma.session.findFirstOrThrow({ where: { userId: t.owner.id }, orderBy: { createdAt: "asc" } });
    const base = { userId: t.owner.id, organizationId: t.org.id, sessionId: current.id, ip: ip(), userAgent: "test" };

    const wrong = await changePassword({ ...base, currentPassword: "not-the-password", newPassword: "tractor-seed-lamp-92" });
    assert.equal(!wrong.ok && wrong.field, "currentPassword");
    const same = await changePassword({ ...base, currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });
    assert.equal(!same.ok && same.field, "newPassword");
    const weak = await changePassword({ ...base, currentPassword: TEST_PASSWORD, newPassword: "Password123!" });
    assert.match(!weak.ok ? weak.message : "", /common/);
    assert.ok(await loadSession(elsewhere), "nothing changed yet");

    const done = await changePassword({ ...base, currentPassword: TEST_PASSWORD, newPassword: "tractor-seed-lamp-92" });
    assert.equal(done.ok, true);
    assert.equal(done.ok && done.endedSessions, 1);
    assert.equal(await loadSession(elsewhere), null, "the other sign-in is over");
    assert.ok(await loadSession(here), "the session that made the change stays");
    const login = (await import("./login.ts")).login;
    assert.equal((await login({ email: t.owner.email, password: "tractor-seed-lamp-92", ip: ip(), userAgent: "test" })).ok, true);
    assert.equal((await login({ email: t.owner.email, password: TEST_PASSWORD, ip: ip(), userAgent: "test" })).ok, false);
    const audit = await prisma.auditLog.findMany({ where: { organizationId: t.org.id, module: "auth", action: { in: ["password_change", "password_change_failed"] } } });
    assert.equal(audit.length, 2, "one failed and one done");
    assert.equal(JSON.stringify(audit).includes("tractor"), false, "no password in the audit log");

    // five wrong old passwords in a row lock the change for a while
    const other = await withLocked(t.owner.id, base);
    assert.equal(other, 429);
  });
});

async function withLocked(userId: string, base: { userId: string; organizationId: string; sessionId: string; ip: string; userAgent: string }) {
  let last = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await changePassword({ ...base, currentPassword: `wrong-${randomUUID()}`, newPassword: "another-long-pass-55" });
    last = result.ok ? 200 : result.status;
  }
  await prisma.rateLimit.deleteMany({ where: { scope: "pw-change" } });
  assert.ok(userId);
  return last;
}

test("the audit log page: newest first, a page of 50, filters by action, module, user and Dhaka day", async () => {
  await withTestOrg(async (t) => {
    const stamp = randomUUID().slice(0, 6);
    for (let index = 0; index < AUDIT_PAGE_SIZE + 5; index += 1) {
      await writeAudit({ organizationId: t.org.id, userId: t.owner.id, action: index % 2 === 0 ? `alpha-${stamp}` : `beta-${stamp}`, module: "test", entityType: "thing", ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36" });
    }
    const first = await searchAuditLogs(t.org.id, { page: 1 });
    assert.equal(first.total, AUDIT_PAGE_SIZE + 5);
    assert.equal(first.rows.length, AUDIT_PAGE_SIZE);
    assert.equal(first.pages, 2);
    const second = await searchAuditLogs(t.org.id, { page: 2 });
    assert.equal(second.rows.length, 5);
    assert.equal((await searchAuditLogs(t.org.id, { page: 99 })).page, 2, "a page past the end is the last page");
    assert.equal((await searchAuditLogs(t.org.id, { page: 1, action: `alpha-${stamp}` })).total, 28);
    assert.equal((await searchAuditLogs(t.org.id, { page: 1, module: "nothing" })).total, 0);
    assert.equal((await searchAuditLogs(t.org.id, { page: 1, user: t.owner.email })).total, AUDIT_PAGE_SIZE + 5);
    assert.equal((await searchAuditLogs(t.org.id, { page: 1, user: "nobody@nowhere.example" })).total, 0);
    // a Dhaka day: now is in today's Dhaka day, and not in a day long past
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
    assert.equal((await searchAuditLogs(t.org.id, { page: 1, from: today, to: today })).total, AUDIT_PAGE_SIZE + 5);
    assert.equal((await searchAuditLogs(t.org.id, { page: 1, from: "2020-01-01", to: "2020-01-02" })).total, 0);
    // the log of another shop is not in it
    assert.equal((await searchAuditLogs(randomUUID(), { page: 1 })).total, 0);
    assert.equal(first.rows[0].ip, "203.0.113.7");
  });
});

test("a browser's text becomes a short device name", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"), "Chrome on Windows");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0"), "Edge on Windows");
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"), "Chrome on Android");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"), "Safari on iOS");
  assert.equal(deviceLabel(null), "");
  assert.equal(deviceLabel("x".repeat(100)).length, 40);
});

test("the language cookie is HttpOnly (only the server reads it)", async () => {
  const response = await localeRoute(new Request("http://127.0.0.1/api/v1/locale", { method: "POST", headers: { origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ lang: "bn" }) }), { params: Promise.resolve({}) });
  // the language is a cookie only the server reads; the cookie flag is checked in the source the route is built from
  assert.equal(response.status, 200);
  const source = (await import("node:fs")).readFileSync(new URL("../../app/api/v1/locale/route.ts", import.meta.url), "utf8");
  assert.match(source, /Max-Age=31536000; SameSite=Lax; HttpOnly/);
  assert.match(response.headers.get("set-cookie") ?? "", /meridian_lang=bn/);
});
