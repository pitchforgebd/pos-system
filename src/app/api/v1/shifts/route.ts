import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { listShifts, openShift } from "@/modules/shifts/shifts";

const bodySchema = z.object({ openingCash: z.string().max(24), cashAccountId: z.string().uuid().optional() });

export const GET = defineRoute({
  permission: "shifts.manage",
  handler: async ({ session }) => {
    if (!session.branchId) {
      return jsonError("VALIDATION_ERROR", "A branch is required.", 400);
    }
    return jsonOk(await listShifts(session.organizationId, session.branchId));
  },
});

export const POST = defineRoute({
  permission: "shifts.manage",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and opening cash are required.", 400);
    }
    const result = await openShift({ ...actor, idempotencyKey: key, openingCash: parsed.data.openingCash, cashAccountId: parsed.data.cashAccountId });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
