import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { stockActor } from "@/modules/inventory/actor";
import { postDamage } from "@/modules/inventory/documents";

const bodySchema = z.object({
  productId: z.string().uuid(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  place: z.string().trim().min(1).max(191),
  lot: z.string().trim().max(64).optional(),
  purchasePrice: z.string(),
  salePrice: z.string(),
  discountAmount: z.string(),
  vatAmount: z.string(),
  quantity: z.string(),
  reason: z.string().trim().min(1).max(255),
  warehouseId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "inventory.damage");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!actor || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await postDamage({ ...actor, idempotencyKey: "", ...parsed.data });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id }, "Operation completed", 201);
}
