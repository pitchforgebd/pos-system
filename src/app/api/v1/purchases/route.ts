import { z } from "zod";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { listPurchases, postPurchase } from "@/modules/purchasing/purchases";

const bodySchema = z.object({
  supplierId: z.string().uuid(),
  businessDate: isoDate,
  warehouseId: z.string().uuid().optional(),
  paymentAmount: z.string().optional(),
  paymentMethod: z.enum(["CASH", "BANK"]).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().optional(),
        quantity: z.string(),
        unitCost: z.string(),
        lot: z.string().trim().min(1).max(64).optional(),
        manufacturedOn: isoDate.optional(),
        expiresOn: isoDate.optional(),
      }),
    )
    .min(1)
    .max(100),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "purchase.view");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  if (!actor) {
    return jsonError("BUSINESS_RULE", "Select a branch before viewing purchases.", 422);
  }
  return jsonOk(await listPurchases(actor.organizationId, actor.branchId));
}

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "purchase.create");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const key = idempotencyKey(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!actor || !key || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and at least one line are required.", 400);
  }
  const result = await postPurchase({ ...actor, idempotencyKey: key, ...parsed.data });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk(
    { id: result.id, number: result.number, replayed: result.replayed },
    "Operation completed",
    result.replayed ? 200 : 201,
  );
}
