import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { saveCourier } from "@/modules/shipping/couriers";
import { courierBody } from "@/modules/shipping/schema";

// PATCH /api/v1/couriers/:id: change a courier (its condition percentage and delivery charges apply to the shipments made from then on).
export const PATCH = defineRoute<undefined, { id: string }>({
  permission: "settings.manage",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const { id } = await params;
    const parsed = courierBody.safeParse(await request.json().catch(() => null));
    if (!actor || !z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A courier name is required.", 400);
    }
    const result = await saveCourier({ organizationId: actor.organizationId, userId: actor.userId, ip: actor.ip, userAgent: actor.userAgent }, { ...parsed.data, id });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id });
  },
});
