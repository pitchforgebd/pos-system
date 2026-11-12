import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { getOrder, updateOrder } from "@/modules/orders/orders";
import { orderBody } from "@/modules/orders/schema";

export const GET = defineRoute<undefined, { id: string }>({
  permission: "orders.view",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!session.branchId || !z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const order = await getOrder(session.organizationId, session.branchId, id);
    return order ? jsonOk(order) : jsonError("NOT_FOUND", "That record was not found.", 404);
  },
});

// PATCH /api/v1/orders/:id: change a draft order (its lines and figures are replaced and priced again).
export const PATCH = defineRoute<undefined, { id: string }>({
  permission: "orders.create",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const { id } = await params;
    const parsed = orderBody.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, a customer and at least one line are required.", 400);
    }
    const result = await updateOrder({ ...actor, idempotencyKey: key }, id, parsed.data, {
      allowDiscount: session.permissions.has("sales.discount"),
      allowPriceOverride: session.permissions.has("sales.price_override"),
      allowPriceLevel: session.permissions.has("sales.price_level"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, status: result.status, replayed: result.replayed });
  },
});
