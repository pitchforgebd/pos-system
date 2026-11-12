import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { getPurchase, updatePurchase } from "@/modules/purchasing/purchases";
import { purchaseBody } from "@/modules/purchasing/schema";

export const GET = defineRoute<undefined, { id: string }>({
  permission: "purchase.view",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    if (!session.branchId) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const purchase = await getPurchase(session.organizationId, session.branchId, id);
    if (!purchase) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(purchase);
  },
});

// PATCH /api/v1/purchases/:id: change a purchase that is still a draft or only ordered (all of its lines and figures are replaced).
export const PATCH = defineRoute<undefined, { id: string }>({
  permission: "purchase.edit",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    const parsed = purchaseBody.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and at least one line are required.", 400);
    }
    const result = await updatePurchase({ ...actor, idempotencyKey: key }, id, parsed.data);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, status: result.status, replayed: result.replayed });
  },
});
