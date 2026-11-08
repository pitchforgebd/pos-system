import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createCrmContact, listCrmContacts } from "@/modules/customers/crm";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(191),
  phone: z.string().trim().max(32).nullable().optional(),
  segmentId: z.string().uuid().nullable().optional(),
});

export const GET = defineRoute({
  permission: "crm.manage",
  handler: async ({ session }) => {
    return jsonOk(await listCrmContacts(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "crm.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createCrmContact({
      organizationId: session.organizationId,
      actorId: session.userId,
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result.contact, "Operation completed", 201);
  },
});
