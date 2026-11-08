import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { postOpeningStock } from "@/modules/inventory/documents";

const lineSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  quantity: z.string(),
  unitCost: z.string().optional(),
  lot: z.string().trim().max(64).optional(),
  manufacturedOn: isoDate.optional(),
  expiresOn: isoDate.optional(),
});

const bodySchema = z.object({
  businessDate: isoDate,
  warehouseId: z.string().uuid().optional(),
  lines: z.array(lineSchema).min(1).max(100),
});

export const POST = defineRoute({
  permission: "inventory.opening",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and at least one line are required.", 400);
    }
    const result = await postOpeningStock({ ...actor, idempotencyKey: key, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
