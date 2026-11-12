import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { postSupplierAdvance } from "@/modules/purchasing/purchases";
import { advanceBody } from "@/modules/purchasing/schema";

// POST /api/v1/suppliers/:id/advances: money paid to a vendor ahead of a bill.
export const POST = defineRoute<undefined, { id: string }>({
  permission: "suppliers.payment",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    const parsed = advanceBody.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and an advance are required.", 400);
    }
    const result = await postSupplierAdvance({ ...actor, idempotencyKey: key, supplierId: id, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
