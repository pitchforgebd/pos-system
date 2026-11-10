import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { setCustomerTypeLevel, updatePriceLevel } from "@/modules/pricing/admin";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  makeDefault: z.boolean().optional(),
  /** Set the level a customer type buys at: this level (or none, null) for that type. */
  customerTypeId: z.string().uuid().optional(),
  assign: z.boolean().optional(),
});

// Rename a price level, switch it on or off, make it the default; or (customerTypeId) make it the level of a customer type.
export const PATCH = defineRoute<undefined, { id: string }>({
  permission: "settings.manage",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const who = { organizationId: session.organizationId, actorId: session.userId, ip: clientIp(request), userAgent: request.headers.get("user-agent") };
    const result = parsed.data.customerTypeId
      ? await setCustomerTypeLevel({ ...who, customerTypeId: parsed.data.customerTypeId, priceLevelId: parsed.data.assign === false ? null : id })
      : await updatePriceLevel({ ...who, id, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.status === 404 ? "NOT_FOUND" : result.status === 409 ? "CONFLICT" : "BUSINESS_RULE", result.message, result.status);
    }
    return jsonOk({ id });
  },
});
