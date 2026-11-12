import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { confirmOrder } from "@/modules/orders/orders";

// POST /api/v1/quotations/:id/convert: the customer said yes. It is confirmed like any order (the stock is reserved, it gets its ORD number).
export const POST = defineRoute<undefined, { id: string }>({
  permission: ["quotations.manage", "orders.manage"],
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    if (!actor || !key || !z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key and a quotation are required.", 400);
    }
    const result = await confirmOrder({ ...actor, idempotencyKey: key }, id);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, status: result.status, replayed: result.replayed });
  },
});
