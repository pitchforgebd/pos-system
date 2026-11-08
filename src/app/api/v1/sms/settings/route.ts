import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { getSmsSettings, saveSmsSettings } from "@/modules/sms/sms";

const bodySchema = z.object({
  sender: z.string(),
  provider: z.string().nullable().optional(),
  unitPrice: z.string().nullable().optional(),
});

export const GET = defineRoute({
  permission: "sms.manage",
  handler: async ({ session }) => {
    return jsonOk(await getSmsSettings(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "sms.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await saveSmsSettings({
      organizationId: session.organizationId,
      actorId: session.userId,
      sender: parsed.data.sender,
      provider: parsed.data.provider,
      unitPrice: parsed.data.unitPrice,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ saved: true });
  },
});
