import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { listCouriers, saveCourier } from "@/modules/shipping/couriers";
import { courierBody } from "@/modules/shipping/schema";

export const GET = defineRoute({
  permission: "shipments.view",
  handler: async ({ session }) => jsonOk(await listCouriers(session.organizationId)),
});

// POST /api/v1/couriers: a courier with the condition percentage it keeps and what it charges to deliver.
export const POST = defineRoute({
  permission: "settings.manage",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const parsed = courierBody.safeParse(await request.json().catch(() => null));
    if (!actor || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A courier name is required.", 400);
    }
    const result = await saveCourier({ organizationId: actor.organizationId, userId: actor.userId, ip: actor.ip, userAgent: actor.userAgent }, parsed.data);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", 201);
  },
});
