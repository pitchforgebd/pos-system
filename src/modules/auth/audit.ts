import { prisma } from "@/lib/db/client";

export async function listAuditLogs(organizationId: string) {
  return prisma.auditLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      action: true,
      module: true,
      entityType: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  });
}

import type { Prisma } from "@prisma/client";

export async function writeAudit(entry: {
  organizationId?: string | null;
  branchId?: string | null;
  userId?: string | null;
  action: string;
  module: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: entry.organizationId ?? null,
      branchId: entry.branchId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      module: entry.module,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before,
      after: entry.after,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 255) ?? null,
    },
  });
}
