import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import {
  FAILED_LOGIN_AUDIT_PER_HOUR,
  LOGIN_DELAY_AFTER,
  LOGIN_DELAY_MAX_MS,
  LOGIN_IP_LIMIT,
  LOGIN_LIMIT,
  LOGIN_UNKNOWN_IP_LIMIT,
  LOGIN_WINDOW_MS,
} from "@/modules/auth/constants";
import { dummyHash, verifyPassword } from "@/modules/auth/password";
import { clearLimit, isLimited, recordFailure, type LimitRule } from "@/modules/auth/rate-limit";
import { openSession } from "@/modules/auth/session";

const invalid = { ok: false as const, status: 401 as const, message: "Email or password is incorrect." };

/** The counters of one sign-in attempt: this address with this email, this address with any email, and the audit rows written for it. */
export function loginRules(ip: string, email: string) {
  const unknown = ip === "unknown";
  const pair: LimitRule = { scope: "login", key: `${ip}|${email}`, limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS };
  // When the proxy gives no address everyone is "unknown": that bucket has its own, much higher limit, so one shop's staff do not lock each other out
  const address: LimitRule = unknown
    ? { scope: "login-unknown", key: ip, limit: LOGIN_UNKNOWN_IP_LIMIT, windowMs: LOGIN_WINDOW_MS }
    : { scope: "login-ip", key: ip, limit: LOGIN_IP_LIMIT, windowMs: LOGIN_WINDOW_MS };
  const audit: LimitRule = { scope: "login-audit", key: ip, limit: FAILED_LOGIN_AUDIT_PER_HOUR, windowMs: 60 * 60 * 1000 };
  return { pair, address, audit };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Each failure after the second makes the next answer wait a little longer (a step of 500 ms by default, at most 3 s). */
function delayFor(failures: number) {
  const step = Number(process.env.LOGIN_DELAY_STEP_MS ?? "500");
  if (!Number.isFinite(step) || step <= 0 || failures <= LOGIN_DELAY_AFTER) {
    return 0;
  }
  return Math.min((failures - LOGIN_DELAY_AFTER) * step, LOGIN_DELAY_MAX_MS);
}

export async function login(input: {
  email: string;
  password: string;
  ip: string;
  userAgent: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const rules = loginRules(input.ip, email);
  if ((await isLimited(rules.pair)) || (await isLimited(rules.address))) {
    return { ok: false as const, status: 429 as const, message: "Too many attempts. Try again later." };
  }

  const matches = await prisma.user.findMany({
    where: { email },
    select: { id: true, organizationId: true, passwordHash: true, status: true },
  });
  const user = matches.length === 1 ? matches[0] : null;
  // An unknown email costs the same time as a wrong password: a hash is checked either way (S9)
  const hashOk = await verifyPassword(input.password, user?.passwordHash ?? (await dummyHash()));
  const passwordOk = hashOk && user !== null;
  if (!user || user.status !== "ACTIVE" || !passwordOk) {
    const failures = await recordFailure(rules.pair);
    await recordFailure(rules.address);
    // The limit counts every failure; the audit log keeps only a bounded number from one address, so it cannot be filled from outside (S3)
    if ((await recordFailure(rules.audit)) <= FAILED_LOGIN_AUDIT_PER_HOUR) {
      await writeAudit({
        organizationId: user?.organizationId ?? null,
        userId: user?.id ?? null,
        action: "failed_login",
        module: "auth",
        entityType: "user",
        entityId: user?.id ?? null,
        after: { email },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    const wait = delayFor(failures);
    if (wait > 0) {
      await pause(wait);
    }
    return invalid;
  }
  await clearLimit(rules.pair);

  const access = await prisma.userBranchAccess.findMany({
    where: { userId: user.id, organizationId: user.organizationId },
    select: { branchId: true },
    orderBy: { branch: { name: "asc" } },
  });
  const opened = await openSession({
    organizationId: user.organizationId,
    userId: user.id,
    branchId: access[0]?.branchId ?? null,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await writeAudit({
    organizationId: user.organizationId,
    branchId: access[0]?.branchId ?? null,
    userId: user.id,
    action: "login",
    module: "auth",
    entityType: "session",
    entityId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const, token: opened.token };
}
