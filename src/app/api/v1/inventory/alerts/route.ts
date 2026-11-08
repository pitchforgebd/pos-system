import { jsonError, jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { stockActor } from "@/modules/inventory/actor";
import { listStock } from "@/modules/inventory/stock";

export const GET = defineRoute({
  permission: "inventory.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing stock.", 422);
    }
    const rows = await listStock({ organizationId: actor.organizationId, branchId: actor.branchId });
    return jsonOk(rows.filter((row) => row.alert !== "NORMAL"));
  },
});
