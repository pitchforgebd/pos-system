import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { countShift } from "@/modules/shifts/shifts";

const bodySchema = z.object({ actualCash: z.string() });

export const POST = defineRoute<undefined, { id: string }>({
  permission: "shifts.manage",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and the counted cash are required.", 400);
    }
    const result = await countShift({ ...actor, idempotencyKey: key, shiftId: id, actualCash: parsed.data.actualCash });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(
      { id: result.id, replayed: result.replayed, expectedCash: result.replayed ? null : result.expectedCash, difference: result.replayed ? null : result.difference },
      "Operation completed",
      result.replayed ? 200 : 200,
    );
  },
});
