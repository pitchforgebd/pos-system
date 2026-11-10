import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { listTakeOffs, postTakeOff } from "@/modules/inventory/documents";

const bodySchema = z.object({
  businessDate: isoDate,
  purpose: z.enum(["SAMPLE", "DEMO", "FIELD_TRIAL", "OWN_USE", "GIFT"]),
  recipient: z.string().trim().min(1).max(191),
  approvedBy: z.string().trim().min(1).max(191),
  note: z.string().trim().max(500).optional(),
  expenseAccountId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  lines: z
    .array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid().optional(), quantity: z.string(), lot: z.string().trim().max(64).optional() }))
    .min(1)
    .max(100),
});

export const GET = defineRoute({
  permission: "inventory.view",
  handler: async ({ session }) => {
    if (!session.branchId) {
      return jsonError("VALIDATION_ERROR", "A branch is required.", 400);
    }
    return jsonOk(await listTakeOffs(session.organizationId, session.branchId));
  },
});

// Goods leave the warehouse without a sale (sample, demonstration, field trial, own use, gift), at their average cost.
export const POST = defineRoute({
  permission: "inventory.takeoff",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a take-off are required.", 400);
    }
    const result = await postTakeOff({ ...actor, idempotencyKey: key, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
