import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { fulfillRequisition } from "@/modules/commerce/requisitions";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "requisitions.manage");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  if (!auth.session.branchId || !z.string().uuid().safeParse(id).success) {
    return jsonError("VALIDATION_ERROR", "A branch and a requisition are required.", 400);
  }
  const result = await fulfillRequisition({
    organizationId: auth.session.organizationId,
    branchId: auth.session.branchId,
    userId: auth.session.userId,
    requisitionId: id,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id });
}
