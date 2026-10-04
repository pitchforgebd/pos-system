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
}
