import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { applySupplierAdvance } from "@/modules/purchasing/purchases";
import { applyAdvanceBody } from "@/modules/purchasing/schema";

// POST /api/v1/suppliers/:id/advances/apply: use money held with a vendor against what the shop owes them. No cash or bank account moves.
export const POST = defineRoute<undefined, { id: string }>({
  permission: "suppliers.payment",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    const parsed = applyAdvanceBody.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and an amount are required.", 400);
    }
    const result = await applySupplierAdvance({ ...actor, idempotencyKey: key, supplierId: id, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
