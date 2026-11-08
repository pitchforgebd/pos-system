import { jsonError, jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { stockActor } from "@/modules/inventory/actor";
import { discardHeldTicket } from "@/modules/sales/tickets";

export const DELETE = defineRoute<undefined, { id: string }>({
  permission: "sales.create",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before discarding a ticket.", 422);
    }
    const { id } = await params;
    const result = await discardHeldTicket(actor.organizationId, actor.branchId, id);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id });
  },
});
