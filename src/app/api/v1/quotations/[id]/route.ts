import { z } from "zod";

import { jsonError, jsonOk } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { getQuotation } from "@/modules/commerce/quotations";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "quotations.manage");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  if (!auth.session.branchId || !z.string().uuid().safeParse(id).success) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const quotation = await getQuotation(auth.session.organizationId, auth.session.branchId, id);
  if (!quotation) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  return jsonOk(quotation);
}
