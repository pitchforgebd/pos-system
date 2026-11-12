import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { settleBody } from "@/modules/shipping/schema";
import { settleCourier, unsettledParcels } from "@/modules/shipping/settlements";

// GET /api/v1/couriers/:id/settle: the parcels that wait to be settled, with what each settles.
export const GET = defineRoute<undefined, { id: string }>({
  permission: "couriers.settle",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!session.branchId || !z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(await unsettledParcels(session.organizationId, session.branchId, id));
  },
});

// POST /api/v1/couriers/:id/settle: what the courier paid for the ticked parcels. A difference needs a reason and couriers.approve_difference.
export const POST = defineRoute<undefined, { id: string }>({
  permission: "couriers.settle",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    const parsed = settleBody.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, the parcels and what came are required.", 400);
    }
    const result = await settleCourier({ ...actor, idempotencyKey: key }, { courierId: id, canApproveDifference: session.permissions.has("couriers.approve_difference"), ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, netReceived: result.netReceived, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
