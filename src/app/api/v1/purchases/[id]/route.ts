import { z } from "zod";

import { jsonError, jsonOk } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { getPurchase } from "@/modules/purchasing/purchases";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "purchase.view");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  if (!auth.session.branchId) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const purchase = await getPurchase(auth.session.organizationId, auth.session.branchId, id);
  if (!purchase) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  return jsonOk(purchase);
}
