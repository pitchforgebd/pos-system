import { jsonError, jsonOk } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { stockActor } from "@/modules/inventory/actor";
import { getJournal } from "@/modules/accounting/books";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "accounting.view");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  if (!actor) {
    return jsonError("BUSINESS_RULE", "Select a branch before viewing journals.", 422);
  }
  const { id } = await context.params;
  const journal = await getJournal(actor.organizationId, actor.branchId, id);
  if (!journal) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  return jsonOk(journal);
}
