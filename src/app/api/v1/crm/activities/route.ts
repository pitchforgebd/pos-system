import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createCrmActivity } from "@/modules/customers/crm";

const bodySchema = z.object({
  contactId: z.string().uuid(),
  businessDate: isoDate,
  note: z.string().trim().min(1).max(255),
});

export const POST = defineRoute({
  permission: "crm.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createCrmActivity({
      organizationId: session.organizationId,
      actorId: session.userId,
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result.activity, "Operation completed", 201);
  },
});
