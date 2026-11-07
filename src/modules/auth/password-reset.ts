import { prisma } from "@/lib/db/client";
import { runTx } from "@/core/tx/run";
import { writeAudit } from "@/modules/auth/audit";
import { RESET_LIMIT, RESET_TOKEN_SECONDS, RESET_WINDOW_MS } from "@/modules/auth/constants";
import { hashPassword } from "@/modules/auth/password";
import { isLimited, recordFailure } from "@/modules/auth/rate-limit";
import { revokeUserSessions } from "@/modules/auth/session";
import { sendResetLink } from "@/modules/auth/mail";
import { hashToken, newToken } from "@/modules/auth/tokens";

export async function requestPasswordReset(input: { email: string; ip: string; userAgent: string | null }) {
  const email = input.email.trim().toLowerCase();
  const key = `reset:${input.ip}:${email}`;
  if (isLimited(key, RESET_LIMIT, RESET_WINDOW_MS)) {
    return { ok: false as const, status: 429 as const };
  }
  recordFailure(key, RESET_WINDOW_MS);

  const matches = await prisma.user.findMany({
    where: { email, status: "ACTIVE" },
    select: { id: true, organizationId: true },
  });
  const user = matches.length === 1 ? matches[0] : null;
  if (!user) {
    return { ok: true as const, token: null };
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_SECONDS * 1000);
  await prisma.passwordReset.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "password_reset_request",
    module: "auth",
    entityType: "user",
    entityId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await sendResetLink(email, token).catch(() => false);
  return { ok: true as const, token, organizationId: user.organizationId };
}

export async function resetPassword(input: { token: string; password: string; ip: string; userAgent: string | null }) {
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(input.token) } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) {
    return { ok: false as const, message: "This reset link is invalid or expired." };
  }
  const passwordHash = await hashPassword(input.password);
  await runTx(async (tx) => {
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await tx.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  await revokeUserSessions(row.userId);
  await writeAudit({
    organizationId: row.organizationId,
    userId: row.userId,
    action: "password_reset",
    module: "auth",
    entityType: "user",
    entityId: row.userId,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true as const };
}
