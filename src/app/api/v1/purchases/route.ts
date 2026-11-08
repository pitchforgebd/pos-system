import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
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

export const GET = defineRoute({
  permission: "purchase.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing purchases.", 422);
    }
    return jsonOk(await listPurchases(actor.organizationId, actor.branchId));
  },
});

export const POST = defineRoute({
  permission: "purchase.create",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
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
  },
});
