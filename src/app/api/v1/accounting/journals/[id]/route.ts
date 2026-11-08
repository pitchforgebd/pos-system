import { jsonError, jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { stockActor } from "@/modules/inventory/actor";
import { getJournal } from "@/modules/accounting/books";

export const GET = defineRoute<undefined, { id: string }>({
  permission: "accounting.view",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing journals.", 422);
    }
    const { id } = await params;
    const journal = await getJournal(actor.organizationId, actor.branchId, id);
    if (!journal) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(journal);
  },
});
