import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { cancelOrder, confirmOrder, deliverOrder, dispatchOrder, packOrder } from "@/modules/orders/orders";
import { cancelBody, dispatchBody } from "@/modules/orders/schema";

// POST /api/v1/orders/:id/confirm | pack | dispatch | deliver | cancel: one step of the order's life. Each takes an Idempotency-Key.
export const POST = defineRoute<undefined, { id: string; action: string }>({
  permission: "orders.manage",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id, action } = await params;
    if (!actor || !key || !z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const who = { ...actor, idempotencyKey: key };
    const body = (await request.json().catch(() => ({}))) ?? {};
    let result;
    if (action === "confirm") {
      result = await confirmOrder(who, id);
    } else if (action === "pack") {
      result = await packOrder(who, id);
    } else if (action === "deliver") {
      result = await deliverOrder(who, id);
    } else if (action === "cancel") {
      const parsed = cancelBody.safeParse(body);
      result = parsed.success ? await cancelOrder(who, id, parsed.data.note) : null;
    } else if (action === "dispatch") {
      const parsed = dispatchBody.safeParse(body);
      result = parsed.success ? await dispatchOrder(who, id, parsed.data) : null;
    } else {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    if (!result) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, status: result.status, replayed: result.replayed });
  },
});
