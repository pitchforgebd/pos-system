import { defineRoute } from "@/core/http/define-route";
import { listQuery } from "@/core/list";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { listPurchases, placePurchase, purchaseSorts } from "@/modules/purchasing/purchases";
import { newPurchaseBody } from "@/modules/purchasing/schema";

const STATUSES = ["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"] as const;

export const GET = defineRoute({
  permission: "purchase.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing purchases.", 422);
    }
    const params = new URL(request.url).searchParams;
    const query = listQuery({ page: params.get("page"), pageSize: params.get("pageSize"), sort: params.get("sort") }, { sorts: purchaseSorts });
    const status = STATUSES.find((value) => value === params.get("status"));
    const { rows, page } = await listPurchases(actor.organizationId, actor.branchId, query, params.get("q") ?? "", status);
    return jsonOk(rows, "Operation completed", 200, { page });
  },
});

// POST /api/v1/purchases: a new purchase, taken as far as `mode` says (draft, ordered, or received at once, the default).
export const POST = defineRoute({
  permission: "purchase.create",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = newPurchaseBody.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and at least one line are required.", 400);
    }
    const { mode, ...purchase } = parsed.data;
    const result = await placePurchase({ ...actor, idempotencyKey: key }, purchase, mode);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, status: result.status, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
