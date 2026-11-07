import { z } from "zod";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { stockActor } from "@/modules/inventory/actor";
import { redeemLoyalty } from "@/modules/reference/extras";

const bodySchema = z.object({
  customerId: z.string().uuid(),
  points: z.string(),
  businessDate: isoDate,
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
  const denied = requirePermission(auth.session, "loyalty.manage");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!actor || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "A branch, a customer, and the points are required.", 400);
  }
  const result = await redeemLoyalty({ ...actor, ...parsed.data });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id }, "Operation completed", 201);
}
