import { defineRoute } from "@/core/http/define-route";
import { listQuery } from "@/core/list";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { listShipments, shipmentSorts } from "@/modules/shipping/shipments";

const STATUSES = ["CREATED", "PICKED", "IN_TRANSIT", "DELIVERED", "RETURNED", "LOST"] as const;

// GET /api/v1/shipments?status=&courierId=&q=&page=: the branch's shipments, newest first. (A shipment is made by dispatching an order.)
export const GET = defineRoute({
  permission: "shipments.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing shipments.", 422);
    }
    const params = new URL(request.url).searchParams;
    const query = listQuery({ page: params.get("page"), pageSize: params.get("pageSize"), sort: params.get("sort") }, { sorts: shipmentSorts });
    const courier = params.get("courierId") ?? undefined;
    const { rows, page } = await listShipments(actor.organizationId, actor.branchId, query, {
      status: STATUSES.find((value) => value === params.get("status")),
      courierId: courier && /^[0-9a-f-]{36}$/i.test(courier) ? courier : undefined,
      q: params.get("q") ?? undefined,
    });
    return jsonOk(rows, "Operation completed", 200, { page });
  },
});
