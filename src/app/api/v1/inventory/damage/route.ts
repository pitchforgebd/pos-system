import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { postDamage } from "@/modules/inventory/documents";

const bodySchema = z.object({
  productId: z.string().uuid(),
  businessDate: isoDate,
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

export const POST = defineRoute({
  permission: "inventory.damage",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a damage record are required.", 400);
    }
    const result = await postDamage({ ...actor, idempotencyKey: key, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
