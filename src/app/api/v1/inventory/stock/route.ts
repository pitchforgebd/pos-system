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
    const params = new URL(request.url).searchParams;
    const alert = params.get("alert");
    return jsonOk(
      await listStock({
        organizationId: actor.organizationId,
        branchId: actor.branchId,
        search: params.get("search")?.trim() || undefined,
        brandId: params.get("brandId")?.trim() || undefined,
        categoryId: params.get("categoryId")?.trim() || undefined,
        alert: alert === "NORMAL" || alert === "LOW" || alert === "OUT_OF_STOCK" ? alert : undefined,
      }),
    );
  },
});
