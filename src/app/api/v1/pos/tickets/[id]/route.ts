import { jsonError, jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { stockActor } from "@/modules/inventory/actor";
import { discardHeldTicket, getHeldTicket } from "@/modules/sales/tickets";

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

// GET /api/v1/pos/tickets/:id: the ticket with its lines and a warning for what is no longer available (resume at the register).
export const GET = defineRoute<undefined, { id: string }>({
  permission: "sales.create",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before resuming a ticket.", 422);
    }
    const { id } = await params;
    const ticket = await getHeldTicket(actor.organizationId, actor.branchId, id);
    return ticket ? jsonOk(ticket) : jsonError("NOT_FOUND", "That record was not found.", 404);
  },
});
