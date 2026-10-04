import { jsonError, jsonOk } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { stockActor } from "@/modules/inventory/actor";
import { listStock } from "@/modules/inventory/stock";

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "inventory.view");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  if (!actor) {
    return jsonError("BUSINESS_RULE", "Select a branch before viewing stock.", 422);
  }
  const rows = await listStock({ organizationId: actor.organizationId, branchId: actor.branchId });
  return jsonOk(rows.filter((row) => row.alert !== "NORMAL"));
}
