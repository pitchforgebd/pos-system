import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createRole, listRoles } from "@/modules/access/roles";

const createSchema = z.object({
  name: z.string().trim().min(1).max(191),
  note: z.string().trim().max(255).optional(),
});

export const GET = defineRoute({
  permission: "roles.manage",
  handler: async ({ session }) => {
    return jsonOk(await listRoles(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "roles.manage",
  handler: async ({ request, session }) => {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createRole({
      organizationId: session.organizationId,
      actorId: session.userId,
      name: parsed.data.name,
      note: parsed.data.note,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError("CONFLICT", result.message, result.status);
    }
    return jsonOk(result.role, "Operation completed", 201);
  },
});
