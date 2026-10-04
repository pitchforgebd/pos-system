import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { countShift } from "@/modules/shifts/shifts";

const bodySchema = z.object({ actualCash: z.string() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "shifts.manage");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const key = idempotencyKey(request);
  const { id } = await context.params;
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
}
