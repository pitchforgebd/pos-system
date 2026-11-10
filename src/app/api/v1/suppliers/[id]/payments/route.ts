import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { postSupplierPayment } from "@/modules/purchasing/purchases";

const bodySchema = z.object({
  businessDate: isoDate,
  amount: z.string(),
  method: z.enum(["CASH", "BANK"]),
  /** The bills this payment is for; the rest settles the oldest debt. */
  allocations: z.array(z.object({ billId: z.string().uuid(), amount: z.string() })).max(100).optional(),
});

export const POST = defineRoute<undefined, { id: string }>({
  permission: "suppliers.payment",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
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
