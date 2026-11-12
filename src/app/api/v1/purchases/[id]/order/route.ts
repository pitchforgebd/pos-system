import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { orderPurchase } from "@/modules/purchasing/purchases";

// POST /api/v1/purchases/:id/order: send a draft to the vendor. It takes its number; nothing is posted.
export const POST = defineRoute<undefined, { id: string }>({
  permission: "purchase.create",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    if (!actor || !key || !z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = await orderPurchase({ ...actor, idempotencyKey: key }, id);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, status: result.status, replayed: result.replayed });
  },
});
