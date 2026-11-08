import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { closeShift } from "@/modules/shifts/shifts";

export const POST = defineRoute<undefined, { id: string }>({
  permission: "shifts.manage",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    if (!actor || !key || !z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a shift are required.", 400);
    }
    const result = await closeShift({ ...actor, idempotencyKey: key, shiftId: id });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, replayed: result.replayed });
  },
});
