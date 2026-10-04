import { jsonError, jsonOk } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { getSale } from "@/modules/sales/sales";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "sales.view");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  if (!auth.session.branchId) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const sale = await getSale(auth.session.organizationId, auth.session.branchId, id);
  if (!sale) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  return jsonOk(sale);
}
