import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createPriceLevel, listPriceLevels } from "@/modules/pricing/admin";

export const GET = defineRoute({
  permission: "products.view",
  handler: async ({ session }) => jsonOk(await listPriceLevels(session.organizationId)),
});

export const POST = defineRoute({
  permission: "settings.manage",
  handler: async ({ request, session }) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(64) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createPriceLevel({ organizationId: session.organizationId, actorId: session.userId, name: parsed.data.name, ip: clientIp(request), userAgent: request.headers.get("user-agent") });
    if (!result.ok) {
      return jsonError(result.status === 409 ? "CONFLICT" : "BUSINESS_RULE", result.message, result.status);
    }
    return jsonOk({ id: result.value }, "Operation completed", 201);
  },
});
