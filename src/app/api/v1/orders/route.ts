import { defineRoute } from "@/core/http/define-route";
import { listQuery } from "@/core/list";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { createOrder, listOrders, orderSorts } from "@/modules/orders/orders";
import { orderBody } from "@/modules/orders/schema";

const STATUSES = ["DRAFT", "CONFIRMED", "PACKED", "DISPATCHED", "DELIVERED", "CANCELLED", "RETURNED"] as const;
const CHANNELS = ["POS", "PHONE", "FACEBOOK", "WEBSITE", "OTHER"] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/v1/orders?status=&channel=&districtId=&from=&to=&q=&page=: the orders of the branch (not quotations unless quotations=1).
export const GET = defineRoute({
  permission: "orders.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing orders.", 422);
    }
    const params = new URL(request.url).searchParams;
    const query = listQuery({ page: params.get("page"), pageSize: params.get("pageSize"), sort: params.get("sort") }, { sorts: orderSorts });
    const from = params.get("from") ?? undefined;
    const to = params.get("to") ?? undefined;
    const district = params.get("districtId") ?? undefined;
    const { rows, page } = await listOrders(actor.organizationId, actor.branchId, query, {
      status: STATUSES.find((value) => value === params.get("status")),
      channel: CHANNELS.find((value) => value === params.get("channel")),
      districtId: district && /^[0-9a-f-]{36}$/i.test(district) ? district : undefined,
      from: from && ISO.test(from) ? from : undefined,
      to: to && ISO.test(to) ? to : undefined,
      q: params.get("q") ?? undefined,
      quotations: params.get("quotations") === "1",
    });
    return jsonOk(rows, "Operation completed", 200, { page });
  },
});

export const POST = defineRoute({
  permission: "orders.create",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = orderBody.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, a customer and at least one line are required.", 400);
    }
    const result = await createOrder({ ...actor, idempotencyKey: key }, parsed.data, {
      allowDiscount: session.permissions.has("sales.discount"),
      allowPriceOverride: session.permissions.has("sales.price_override"),
      allowPriceLevel: session.permissions.has("sales.price_level"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, status: result.status, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
