import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { postSupplierPayment } from "@/modules/purchasing/purchases";
import { paymentBody } from "@/modules/purchasing/schema";

// POST /api/v1/suppliers/:id/payments: pay a vendor from a cash, bank or mobile account (with the charge), for named bills or the oldest debt.
export const POST = defineRoute<undefined, { id: string }>({
  permission: "suppliers.payment",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    const parsed = paymentBody.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a payment are required.", 400);
    }
    const result = await postSupplierPayment({ ...actor, idempotencyKey: key, supplierId: id, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
