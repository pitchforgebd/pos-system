import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { stockActor } from "@/modules/inventory/actor";
import { postDirectReturn } from "@/modules/reference/extras";

const bodySchema = z.object({
  productId: z.string().uuid(),
  quantity: z.string(),
  refundAmount: z.string(),
  method: z.enum(["CASH", "BANK"]),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
  const denied = requirePermission(auth.session, "sales.return");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!actor || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "A branch, a product, a quantity, and a refund are required.", 400);
  }
  const result = await postDirectReturn({ ...actor, ...parsed.data });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id }, "Operation completed", 201);
}
