import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { LOGIN_WINDOW_MS, LOGIN_LIMIT } from "@/modules/auth/constants";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { passwordProblem } from "@/modules/auth/password-policy";
import { clearLimit, isLimited, recordFailure, type LimitRule } from "@/modules/auth/rate-limit";

// A signed-in user changes their own password (U10). The old password is needed (a stolen open session is not enough), a wrong old password counts like a
// wrong sign-in, the new one follows the password rules, and every other session of the user is ended: only the one making the change stays.

type Failure = { ok: false; status: 400 | 429; message: string; field: "currentPassword" | "newPassword" | null };

export async function changePassword(input: {
  userId: string;
  organizationId: string;
  sessionId: string;
  currentPassword: string;
  newPassword: string;
  ip: string;
  userAgent: string | null;
}): Promise<Failure | { ok: true; endedSessions: number }> {
  const rule: LimitRule = { scope: "pw-change", key: input.userId, limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS };
  if (await isLimited(rule)) {
    return { ok: false, status: 429, message: "Too many attempts. Try again later.", field: null };
  }
  const user = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    await recordFailure(rule);
    await writeAudit({ organizationId: input.organizationId, userId: input.userId, action: "password_change_failed", module: "auth", entityType: "user", entityId: input.userId, ip: input.ip, userAgent: input.userAgent });
    return { ok: false, status: 400, message: "The current password is not correct.", field: "currentPassword" };
  }
  if (input.newPassword === input.currentPassword) {
    return { ok: false, status: 400, message: "Choose a password different from the current one.", field: "newPassword" };
  }
  const problem = passwordProblem(input.newPassword, { email: user.email, name: user.name });
  if (problem) {
    return { ok: false, status: 400, message: problem, field: "newPassword" };
  }
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  const ended = await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null, id: { not: input.sessionId } },
    data: { revokedAt: new Date() },
  });
  await clearLimit(rule);
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "password_change",
    module: "auth",
    entityType: "user",
    entityId: input.userId,
    after: { endedSessions: ended.count },
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true, endedSessions: ended.count };
}
