import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { postCashMovement } from "@/modules/shifts/shifts";

const bodySchema = z.object({
  direction: z.enum(["IN", "OUT"]),
  amount: z.string(),
  reason: z.string().trim().max(255).nullable().optional(),
});

export const POST = defineRoute<undefined, { id: string }>({
  permission: "shifts.manage",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a cash movement are required.", 400);
    }
    const result = await postCashMovement({ ...actor, idempotencyKey: key, shiftId: id, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
