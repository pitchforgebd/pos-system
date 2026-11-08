import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createTemplate, listTemplates } from "@/modules/sms/sms";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(191),
  kind: z.enum(["BILL", "DUE_COLLECTION"]),
  body: z.string(),
});

export const GET = defineRoute({
  permission: "sms.manage",
  handler: async ({ session }) => {
    return jsonOk(await listTemplates(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "sms.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createTemplate({
      organizationId: session.organizationId,
      actorId: session.userId,
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result.template, "Operation completed", 201);
  },
});
