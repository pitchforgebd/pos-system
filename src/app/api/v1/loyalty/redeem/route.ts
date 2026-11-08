import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { redeemLoyalty } from "@/modules/reference/extras";

const bodySchema = z.object({
  customerId: z.string().uuid(),
  points: z.string(),
  businessDate: isoDate,
});

export const POST = defineRoute({
  permission: "loyalty.manage",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, a customer, and the points are required.", 400);
    }
    const result = await redeemLoyalty({ ...actor, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", 201);
  },
});
