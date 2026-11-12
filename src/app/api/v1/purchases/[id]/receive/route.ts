import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { receivePurchase } from "@/modules/purchasing/purchases";
import { receiveBody } from "@/modules/purchasing/schema";

// POST /api/v1/purchases/:id/receive: the goods came. The stock comes in at its landed cost and the books are posted, once.
export const POST = defineRoute<undefined, { id: string }>({
  permission: "purchase.create",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    const parsed = receiveBody.safeParse((await request.json().catch(() => ({}))) ?? {});
    if (!actor || !key || !z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = await receivePurchase({ ...actor, idempotencyKey: key }, id, parsed.data);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, status: result.status, replayed: result.replayed });
  },
});
