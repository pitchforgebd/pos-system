import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { listChargeRules, saveChargeRule } from "@/modules/treasury/charges";

const bodySchema = z.object({
  accountId: z.string().uuid(),
  percent: z.string().max(8),
  fixed: z.string().max(24),
  bearer: z.enum(["SHOP", "CUSTOMER"]),
});

// GET /api/v1/settings/charges: each bank and mobile account with its charge rule.
export const GET = defineRoute({
  permission: "settings.manage",
  handler: async ({ session }) => jsonOk(await listChargeRules(session.organizationId)),
});

// POST /api/v1/settings/charges: set what an account takes on a payment (percentage, fixed part, who bears it).
export const POST = defineRoute({
  permission: "settings.manage",
  body: bodySchema,
  handler: async ({ request, session, body }) => {
    const result = await saveChargeRule({ organizationId: session.organizationId, userId: session.userId, ip: clientIp(request), userAgent: request.headers.get("user-agent") }, body);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ ok: true }, "Operation completed");
  },
});
