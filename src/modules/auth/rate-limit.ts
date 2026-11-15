import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@/lib/db/client";

// Login and password-reset limits (H15, S6), kept in the database so a restart or a second server process does not forget them. A counter is one
// row for a scope (what is limited), a key (who: an address, an address with an email) and a fixed time window. The key is stored as a hash, so no
// email address or address sits in this table. Old windows are deleted by `purgeRateLimits`.

export type LimitRule = { scope: string; key: string; limit: number; windowMs: number };

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const windowStart = (windowMs: number, now: number) => new Date(Math.floor(now / windowMs) * windowMs);

/** How many failures this rule has counted in the current window. */
export async function countOf(rule: LimitRule, now = Date.now()) {
  const row = await prisma.rateLimit.findUnique({
    where: { scope_keyHash_windowStart: { scope: rule.scope, keyHash: hashKey(rule.key), windowStart: windowStart(rule.windowMs, now) } },
    select: { count: true },
  });
  return row?.count ?? 0;
}

export async function isLimited(rule: LimitRule) {
  return (await countOf(rule)) >= rule.limit;
}

/** Counts one failure and returns the new count. One statement, so two requests at the same moment both count. */
export async function recordFailure(rule: LimitRule, now = Date.now()) {
  const start = windowStart(rule.windowMs, now);
  const keyHash = hashKey(rule.key);
  await prisma.$executeRaw`
    INSERT INTO rate_limits (id, scope, keyHash, windowStart, count, updatedAt)
    VALUES (${randomUUID()}, ${rule.scope}, ${keyHash}, ${start}, 1, NOW(3))
    ON DUPLICATE KEY UPDATE count = count + 1, updatedAt = NOW(3)
  `;
  return countOf(rule, now);
}

/** Forgets one counter (a successful sign-in clears the failures of that address and email). */
export async function clearLimit(rule: LimitRule) {
  await prisma.rateLimit.deleteMany({ where: { scope: rule.scope, keyHash: hashKey(rule.key) } });
}

/** Deletes the windows that ended more than `keepMs` ago (default two hours: longer than any window in use). Safe to run any time. */
export async function purgeRateLimits(keepMs = 2 * 60 * 60 * 1000, now = Date.now()) {
  const result = await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now - keepMs) } } });
  return result.count;
}
