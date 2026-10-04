import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { stockActor } from "@/modules/inventory/actor";
import { fileClaim } from "@/modules/reference/extras";

const bodySchema = z.object({
  productId: z.string().uuid(),
  customerId: z.string().uuid(),
  serial: z.string().trim().max(64).optional(),
  note: z.string().trim().min(1).max(255),
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
  const denied = requirePermission(auth.session, "products.edit");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!actor || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "A branch, a product, a customer, and a note are required.", 400);
  }
  const result = await fileClaim({ ...actor, ...parsed.data });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id }, "Operation completed", 201);
}
