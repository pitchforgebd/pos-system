import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";
import { LOGIN_LIMIT, LOGIN_WINDOW_MS } from "@/modules/auth/constants";
import { verifyPassword } from "@/modules/auth/password";
import { openSession } from "@/modules/auth/session";

const invalid = { ok: false as const, status: 401 as const, message: "Email or password is incorrect." };

export async function login(input: {
  email: string;
  password: string;
  ip: string;
  userAgent: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const recentFailures = await prisma.auditLog.count({
    where: {
      action: "failed_login",
      ip: input.ip,
      createdAt: { gte: new Date(Date.now() - LOGIN_WINDOW_MS) },
      after: { path: "$.email", equals: email },
    },
  });
  if (recentFailures >= LOGIN_LIMIT) {
    return { ok: false as const, status: 429 as const, message: "Too many attempts. Try again later." };
  }

  const matches = await prisma.user.findMany({
    where: { email },
    select: { id: true, organizationId: true, passwordHash: true, status: true },
  });
  const user = matches.length === 1 ? matches[0] : null;
  const passwordOk = user ? await verifyPassword(input.password, user.passwordHash) : false;
  if (!user || user.status !== "ACTIVE" || !passwordOk) {
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
    return invalid;
  }

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
