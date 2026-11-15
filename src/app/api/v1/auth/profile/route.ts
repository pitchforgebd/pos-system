import { z } from "zod";

import { defineRoute } from "@/core/http/define-route";
import { clientIp, jsonOk } from "@/lib/api/http";
import { prisma } from "@/lib/db/client";
import { writeAudit } from "@/modules/auth/audit";

// POST /api/v1/auth/profile: the signed-in user changes their own name and phone. The email, the roles and the branches are the owner's to change (Users).
export const POST = defineRoute({
  body: z.object({
    name: z.string().trim().min(1).max(191),
    phone: z.string().trim().max(32).nullable().optional(),
  }),
  handler: async ({ request, session, body }) => {
    const before = await prisma.user.findFirstOrThrow({ where: { id: session.userId, organizationId: session.organizationId }, select: { name: true, phone: true } });
    const phone = body.phone ? body.phone : null;
    await prisma.user.update({ where: { id: session.userId }, data: { name: body.name, phone } });
    await writeAudit({
      organizationId: session.organizationId,
      branchId: session.branchId,
      userId: session.userId,
      action: "profile_update",
      module: "auth",
      entityType: "user",
      entityId: session.userId,
      before,
      after: { name: body.name, phone },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonOk({ name: body.name, phone });
  },
});
