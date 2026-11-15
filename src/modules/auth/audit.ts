import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";

export const AUDIT_PAGE_SIZE = 50;

export type AuditQuery = { page: number; action?: string; module?: string; user?: string; from?: string; to?: string };

/** The audit log of one shop (L12, LV-4): newest first, a page at a time, with filters. Dates are Dhaka days; the time shown on the page is Dhaka time. */
export async function searchAuditLogs(organizationId: string, query: AuditQuery) {
  const where: Prisma.AuditLogWhereInput = { organizationId };
  if (query.action) {
    where.action = { contains: query.action };
  }
  if (query.module) {
    where.module = { contains: query.module };
  }
  if (query.user) {
    where.user = { email: { contains: query.user } };
  }
  if (query.from || query.to) {
    // Dhaka has no daylight saving: a Dhaka day starts at 00:00 at +06:00
    where.createdAt = {
      ...(query.from ? { gte: new Date(`${query.from}T00:00:00+06:00`) } : {}),
      ...(query.to ? { lt: new Date(new Date(`${query.to}T00:00:00+06:00`).getTime() + 24 * 60 * 60 * 1000) } : {}),
    };
  }
  const total = await prisma.auditLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(query.page) || 1), pages);
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE,
    select: { id: true, action: true, module: true, entityType: true, entityId: true, ip: true, userAgent: true, createdAt: true, user: { select: { email: true } } },
  });
  return { rows, total, page, pages };
}

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
