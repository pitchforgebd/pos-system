import { prisma } from "@/lib/db/client";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/modules/auth/constants";
import { hashToken, newToken } from "@/modules/auth/tokens";

export type SessionContext = {
  sessionId: string;
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  branchId: string | null;
  permissions: Set<string>;
  branchIds: Set<string>;
  branches: { id: string; name: string }[];
};

async function permissionsFor(userId: string) {
  const rows = await prisma.userRole.findMany({
    where: { userId },
    select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } },
  });
  const codes = new Set<string>();
  for (const row of rows) {
    for (const link of row.role.permissions) {
      codes.add(link.permission.code);
    }
  }
  return codes;
}

export async function loadSession(token: string): Promise<SessionContext | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: { select: { id: true, name: true, email: true, status: true, organizationId: true } },
      branch: { select: { id: true, name: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }
  if (session.user.status === "DISABLED") {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }
  const [access, permissions] = await Promise.all([
    prisma.userBranchAccess.findMany({
      where: { userId: session.userId, organizationId: session.organizationId },
      select: { branch: { select: { id: true, name: true } } },
      orderBy: { branch: { name: "asc" } },
    }),
    permissionsFor(session.userId),
  ]);
  const branches = access.map((row) => row.branch);
  const branchIds = new Set(branches.map((branch) => branch.id));
  const branchId = session.branchId && branchIds.has(session.branchId) ? session.branchId : null;
  return {
    sessionId: session.id,
    userId: session.user.id,
    organizationId: session.user.organizationId,
    name: session.user.name,
    email: session.user.email,
    branchId,
    permissions,
    branchIds,
    branches,
  };
}

export async function openSession(input: {
  organizationId: string;
  userId: string;
  branchId: string | null;
  ip: string | null;
  userAgent: string | null;
}) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.session.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      branchId: input.branchId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 255) ?? null,
    },
  });
  return { token, expiresAt };
}

export async function revokeToken(token: string) {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeUserSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function sessionTokenFromRequest(request: Request) {
  const cookie = request.headers.get("cookie");
  if (!cookie) {
    return null;
  }
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export async function setSessionBranch(sessionId: string, branchId: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { branchId } });
}

export async function findOrganizationBranch(organizationId: string, branchId: string) {
  return prisma.branch.findFirst({
    where: { id: branchId, organizationId },
    select: { id: true, name: true },
  });
}
