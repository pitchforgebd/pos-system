import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { cancelPurchase } from "@/modules/purchasing/purchases";

// POST /api/v1/purchases/:id/cancel: call off a purchase that was not received. A received one is undone by returning the goods.
export const POST = defineRoute<undefined, { id: string }>({
  permission: "purchase.edit",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    if (!actor || !key || !z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = await cancelPurchase({ ...actor, idempotencyKey: key }, id);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, status: result.status, replayed: result.replayed });
  },
});
