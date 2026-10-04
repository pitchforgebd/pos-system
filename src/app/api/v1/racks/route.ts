import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { prisma } from "@/lib/db/client";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { writeAudit } from "@/modules/auth/audit";

const bodySchema = z.object({
  warehouseId: z.string().uuid(),
  name: z.string().trim().min(1).max(191),
});

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
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: parsed.data.warehouseId, organizationId: auth.session.organizationId },
    select: { id: true, branchId: true },
  });
  if (!warehouse) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const rack = await prisma.rack.create({
    data: {
      organizationId: auth.session.organizationId,
      branchId: warehouse.branchId,
      warehouseId: warehouse.id,
      name: parsed.data.name,
    },
    select: { id: true },
  });
  await writeAudit({
    organizationId: auth.session.organizationId,
    userId: auth.session.userId,
    action: "create",
    module: "racks",
    entityType: "rack",
    entityId: rack.id,
    after: { name: parsed.data.name },
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  return jsonOk({ id: rack.id }, "Rack created", 201);
}
