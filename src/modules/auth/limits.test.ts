import "../../tests/helpers/env.ts";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "../../lib/db/client.ts";
import { clientIp, rejectCrossSite } from "../../lib/api/http.ts";
import { FAILED_LOGIN_AUDIT_PER_HOUR, LOGIN_IP_LIMIT, RESET_DONE_IP_LIMIT, RESET_IP_LIMIT } from "./constants.ts";
import { login, loginRules } from "./login.ts";
import { hashPassword } from "./password.ts";
import { requestPasswordReset, resetPassword } from "./password-reset.ts";
import { clearLimit, countOf, isLimited, purgeRateLimits, recordFailure } from "./rate-limit.ts";

// P12 tasks 1-5: the limits live in the database (H15, S6), a second bucket limits one address over any emails (S2), the address "unknown" has its
// own bucket (S5), the audit log cannot be filled from outside (S3), the forwarded host is trusted only behind a proxy (S1), an unknown email costs a
// hash like a wrong password (S9) and repeated failures wait longer (S10). Each test uses its own address and emails: the counters are shared and last.

const stamp = () => randomUUID().slice(0, 8);
const address = () => `192.0.2.${1 + Math.floor(Math.random() * 250)}`;

test("a counter is a row in the database: it is counted, read back, cleared and purged", async () => {
  const key = `${stamp()}|x@example.com`;
  const rule = { scope: "test-counter", key, limit: 3, windowMs: 60_000 };
  assert.equal(await isLimited(rule), false);
  assert.equal(await recordFailure(rule), 1);
  assert.equal(await recordFailure(rule), 2);
  assert.equal(await isLimited(rule), false);
  assert.equal(await recordFailure(rule), 3);
  assert.equal(await isLimited(rule), true);
  // the key is stored as a hash: neither the email nor the address is in the table
  const rows = await prisma.rateLimit.findMany({ where: { scope: "test-counter" } });
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((row) => !row.keyHash.includes("@") && row.keyHash.length === 64));
  // two requests at the same moment both count
  await Promise.all([recordFailure(rule), recordFailure(rule), recordFailure(rule)]);
  assert.equal(await countOf(rule), 6);
  await clearLimit(rule);
  assert.equal(await countOf(rule), 0);
  // an old window is deleted
  await recordFailure(rule, Date.now() - 5 * 60 * 60 * 1000);
  assert.ok((await purgeRateLimits()) >= 1);
  await prisma.rateLimit.deleteMany({ where: { scope: "test-counter" } });
});

test("sign-in: five failures for one email lock that pair, twenty from one address lock the address whatever the email", async () => {
  const ip = address();
  const who = stamp();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await login({ email: `a-${who}@example.com`, password: "wrong-password-1", ip, userAgent: "test" })).ok, false);
  }
  const pair = await login({ email: `a-${who}@example.com`, password: "wrong-password-1", ip, userAgent: "test" });
  assert.equal(!pair.ok && pair.status, 429);
  // another email from the same address is still let in (not the pair), until the address itself has had twenty failures
  for (let attempt = 5; attempt < LOGIN_IP_LIMIT; attempt += 1) {
    const result = await login({ email: `b${attempt}-${who}@example.com`, password: "wrong-password-1", ip, userAgent: "test" });
    assert.equal(!result.ok && result.status, 401, `attempt ${attempt}`);
  }
  const wide = await login({ email: `c-${who}@example.com`, password: "wrong-password-1", ip, userAgent: "test" });
  assert.equal(!wide.ok && wide.status, 429, "the address is limited over any email");
  // another address is not affected
  let elsewhere = address();
  while (elsewhere === ip) {
    elsewhere = address();
  }
  const other = await login({ email: `a-${who}@example.com`, password: "wrong-password-1", ip: elsewhere, userAgent: "test" });
  assert.equal(!other.ok && other.status, 401);
  await prisma.auditLog.deleteMany({ where: { action: "failed_login", ip: { in: [ip, elsewhere] } } });
});

test("the address unknown has its own much higher bucket: a few failures never lock everyone out", async () => {
  const rules = loginRules("unknown", `z-${stamp()}@example.com`);
  assert.equal(rules.address.scope, "login-unknown");
  assert.ok(rules.address.limit >= 100);
  assert.equal(loginRules("203.0.113.9", "z@example.com").address.scope, "login-ip");
  assert.equal(await isLimited(rules.address), false);
});

test("the audit log keeps a bounded number of failed sign-ins from one address, the limit still counts them all", async () => {
  const ip = address();
  const who = stamp();
  for (let attempt = 0; attempt < FAILED_LOGIN_AUDIT_PER_HOUR + 5; attempt += 1) {
    await login({ email: `f${attempt}-${who}@example.com`, password: "wrong-password-1", ip, userAgent: "test" });
  }
  const kept = await prisma.auditLog.count({ where: { action: "failed_login", ip } });
  assert.equal(kept, FAILED_LOGIN_AUDIT_PER_HOUR);
  assert.equal(await countOf(loginRules(ip, "x").address), FAILED_LOGIN_AUDIT_PER_HOUR + 5);
  await prisma.auditLog.deleteMany({ where: { action: "failed_login", ip } });
});

test("password reset: asking is limited per address over any email, finishing with a wrong token is limited per address", async () => {
  const ip = address();
  const who = stamp();
  for (let attempt = 0; attempt < RESET_IP_LIMIT; attempt += 1) {
    const asked = await requestPasswordReset({ email: `r${attempt}-${who}@example.com`, ip, userAgent: "test" });
    assert.equal(asked.ok, true, `ask ${attempt}`);
  }
  const blocked = await requestPasswordReset({ email: `late-${who}@example.com`, ip, userAgent: "test" });
  assert.equal(blocked.ok, false);

  const finishing = address();
  for (let attempt = 0; attempt < RESET_DONE_IP_LIMIT; attempt += 1) {
    const result = await resetPassword({ token: `${"x".repeat(30)}${attempt}`, password: "a-long-new-password-1", ip: finishing, userAgent: "test" });
    assert.equal(!result.ok && result.status, 400);
  }
  const stopped = await resetPassword({ token: "y".repeat(31), password: "a-long-new-password-1", ip: finishing, userAgent: "test" });
  assert.equal(!stopped.ok && stopped.status, 429);
});

test("the forwarded host is trusted only behind a trusted proxy", () => {
  const previous = process.env.TRUST_PROXY;
  const request = () => new Request("http://shop.local/api/v1/x", { method: "POST", headers: { origin: "https://evil.example", host: "shop.local", "x-forwarded-host": "evil.example" } });
  delete process.env.TRUST_PROXY;
  assert.equal(rejectCrossSite(request())?.status, 403, "a forged forwarded host does not make a foreign origin the same site");
  process.env.TRUST_PROXY = "1";
  assert.equal(rejectCrossSite(request()), null, "behind a trusted proxy the forwarded host is the public host");
  if (previous === undefined) {
    delete process.env.TRUST_PROXY;
  } else {
    process.env.TRUST_PROXY = previous;
  }
});

test("a missing address is logged as unknown, at most once in a while", () => {
  const previous = process.env.TRUST_PROXY;
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => void warnings.push(String(message));
  try {
    process.env.TRUST_PROXY = "1";
    const bare = new Request("http://shop.local/api/v1/auth/login");
    assert.equal(clientIp(bare), "unknown");
    assert.equal(clientIp(bare), "unknown");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unknown/);
  } finally {
    console.warn = original;
    if (previous === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = previous;
    }
  }
});

test("each failure after the second waits longer before the answer", async () => {
  process.env.LOGIN_DELAY_STEP_MS = "150";
  const ip = address();
  try {
    const email = `d-${stamp()}@example.com`;
    const took: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const started = Date.now();
      await login({ email, password: "wrong-password-1", ip, userAgent: "test" });
      took.push(Date.now() - started);
    }
    assert.ok(took[2] >= 140, `third failure waits one step (${took[2]} ms)`);
    assert.ok(took[3] >= 290, `fourth failure waits two steps (${took[3]} ms)`);
    assert.ok(took[0] < 140 && took[1] < 140, `the first two do not wait (${took[0]}, ${took[1]} ms)`);
  } finally {
    process.env.LOGIN_DELAY_STEP_MS = "0";
    await prisma.auditLog.deleteMany({ where: { action: "failed_login", ip } });
  }
});

test("an unknown email costs a hash, like a wrong password (the time tells nothing)", async () => {
  process.env.BCRYPT_COST = "10";
  const ip = address();
  try {
    const started = Date.now();
    await hashPassword("some-password-to-time-1");
    const oneHash = Date.now() - started;
    const unknownStart = Date.now();
    await login({ email: `nobody-${stamp()}@example.com`, password: "wrong-password-1", ip, userAgent: "test" });
    const unknown = Date.now() - unknownStart;
    assert.ok(unknown >= oneHash * 0.6, `unknown email took ${unknown} ms, a hash takes ${oneHash} ms`);
  } finally {
    process.env.BCRYPT_COST = "4";
    await prisma.auditLog.deleteMany({ where: { action: "failed_login", ip } });
  }
});
