import { z } from "zod";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { postSaleReturn } from "@/modules/sales/returns";

const bodySchema = z.object({
  occurredOn: isoDate,
  lines: z.array(z.object({ saleItemId: z.string().uuid(), quantity: z.string() })).min(1).max(100),
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
  const denied = requirePermission(auth.session, "sales.return");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const key = idempotencyKey(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!actor || !key || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and at least one line are required.", 400);
  }
  const { id } = await context.params;
  const result = await postSaleReturn({ ...actor, idempotencyKey: key, saleId: id, ...parsed.data });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id, number: result.number, total: result.total, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
}
