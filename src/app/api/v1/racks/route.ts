import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

const bodySchema = z.object({
  warehouseId: z.string().uuid(),
  name: z.string().trim().min(1).max(191),
});

export const POST = defineRoute({
  permission: "branches.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: parsed.data.warehouseId, organizationId: session.organizationId },
      select: { id: true, branchId: true },
    });
    if (!warehouse) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const rack = await prisma.rack.create({
      data: {
        organizationId: session.organizationId,
        branchId: warehouse.branchId,
        warehouseId: warehouse.id,
        name: parsed.data.name,
      },
      select: { id: true },
    });
    await writeAudit({
      organizationId: session.organizationId,
      userId: session.userId,
      action: "create",
      module: "racks",
      entityType: "rack",
      entityId: rack.id,
      after: { name: parsed.data.name },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonOk({ id: rack.id }, "Rack created", 201);
  },
});
