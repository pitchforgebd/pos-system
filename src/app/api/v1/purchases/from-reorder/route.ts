import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { draftsFromReorder } from "@/modules/purchasing/purchases";

const body = z.object({ productIds: z.array(z.string().uuid()).max(500).optional() });

// POST /api/v1/purchases/from-reorder: purchase drafts, one per vendor, from the reorder list (all of it, or the products named).
export const POST = defineRoute({
  permission: "purchase.create",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = body.safeParse((await request.json().catch(() => ({}))) ?? {});
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = await draftsFromReorder({ ...actor, idempotencyKey: key }, parsed.data);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ ids: result.ids, skipped: result.skipped, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
