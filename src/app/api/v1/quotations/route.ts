import { defineRoute } from "@/core/http/define-route";
import { listQuery } from "@/core/list";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { createOrder, listOrders, orderSorts } from "@/modules/orders/orders";
import { orderBody } from "@/modules/orders/schema";

// A quotation is a draft order with its own QUO number and a valid-until date (P06 task 4).
export const GET = defineRoute({
  permission: "quotations.manage",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("VALIDATION_ERROR", "A branch is required.", 400);
    }
    const params = new URL(request.url).searchParams;
    const query = listQuery({ page: params.get("page"), pageSize: params.get("pageSize"), sort: params.get("sort") }, { sorts: orderSorts });
    const { rows, page } = await listOrders(actor.organizationId, actor.branchId, query, { quotations: true, q: params.get("q") ?? undefined });
    return jsonOk(rows, "Operation completed", 200, { page });
  },
});

export const POST = defineRoute({
  permission: "quotations.manage",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = orderBody.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, a customer and a quotation are required.", 400);
    }
    const result = await createOrder({ ...actor, idempotencyKey: key }, { ...parsed.data, isQuotation: true }, {
      allowDiscount: session.permissions.has("sales.discount"),
      allowPriceOverride: session.permissions.has("sales.price_override"),
      allowPriceLevel: session.permissions.has("sales.price_level"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, status: result.status, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
