import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { moveBody, returnBody } from "@/modules/shipping/schema";
import { moveShipment, returnShipment } from "@/modules/shipping/shipments";

const MOVES = { picked: "PICKED", "in-transit": "IN_TRANSIT", delivered: "DELIVERED", lost: "LOST" } as const;

// POST /api/v1/shipments/:id/picked | in-transit | delivered | lost | return: a step of the parcel's way. `return` brings the parcel back
// and returns the whole sale. Each takes an Idempotency-Key.
export const POST = defineRoute<undefined, { id: string; action: string }>({
  permission: "shipments.manage",
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
    if (action === "return") {
      const parsed = returnBody.safeParse(body);
      result = parsed.success ? await returnShipment(who, id, parsed.data) : null;
    } else if (action in MOVES) {
      const parsed = moveBody.safeParse(body);
      result = parsed.success ? await moveShipment(who, id, MOVES[action as keyof typeof MOVES], parsed.data) : null;
    } else {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    if (!result) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, status: result.status, replayed: result.replayed });
  },
});
