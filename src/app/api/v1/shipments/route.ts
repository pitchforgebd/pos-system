import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { addShipment } from "@/modules/reference/extras";

const bodySchema = z.object({
  courierId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  reference: z.string().trim().max(64).optional(),
  trackingCode: z.string().trim().max(64).optional(),
});

export const POST = defineRoute({
  permission: "settings.manage",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch and a courier are required.", 400);
    }
    const result = await addShipment({ ...actor, ...parsed.data, customerId: parsed.data.customerId });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", 201);
  },
});
