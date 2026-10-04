import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { postSupplierPayment } from "@/modules/purchasing/purchases";

const bodySchema = z.object({
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string(),
  method: z.enum(["CASH", "BANK"]),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "suppliers.payment");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const key = idempotencyKey(request);
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!actor || !key || !z.string().uuid().safeParse(id).success || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a payment are required.", 400);
  }
  const result = await postSupplierPayment({ ...actor, idempotencyKey: key, supplierId: id, ...parsed.data });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
}
