import { jsonError, jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { listQuery } from "@/core/list";
import { stockActor } from "@/modules/inventory/actor";
import { listLowStock } from "@/modules/inventory/alerts";

// The low and out-of-stock rows of the branch, filtered in SQL and paged (?page=&pageSize=&q=).
export const GET = defineRoute({
  permission: "inventory.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing stock.", 422);
    }
    const url = new URL(request.url);
    const query = listQuery({ page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize") }, { sorts: { name: [{ id: "asc" }] }, defaultSort: "name" });
    const result = await listLowStock({ organizationId: actor.organizationId, branchId: actor.branchId, search: url.searchParams.get("q") ?? undefined, query });
    return jsonOk(result.rows, "Operation completed", 200, { page: result.page });
  },
});
