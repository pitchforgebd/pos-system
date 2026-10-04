import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

const bodySchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(1).max(191),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "branches.manage");
  if (denied) {
    return denied;
  }
  const rows = await prisma.warehouse.findMany({
    where: { organizationId: auth.session.organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, branch: { select: { name: true } } },
  });
  return jsonOk(rows.map((row) => ({ id: row.id, name: row.name, status: row.status, branchName: row.branch.name })));
}

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "branches.manage");
  if (denied) {
    return denied;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const branch = await prisma.branch.findFirst({
    where: { id: parsed.data.branchId, organizationId: auth.session.organizationId },
    select: { id: true },
  });
  if (!branch) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const warehouse = await prisma.warehouse.create({
    data: { organizationId: auth.session.organizationId, branchId: branch.id, name: parsed.data.name },
    select: { id: true },
  });
  await writeAudit({
    organizationId: auth.session.organizationId,
    userId: auth.session.userId,
    action: "create",
    module: "warehouses",
    entityType: "warehouse",
    entityId: warehouse.id,
    after: { name: parsed.data.name },
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  return jsonOk({ id: warehouse.id }, "Warehouse created", 201);
}
