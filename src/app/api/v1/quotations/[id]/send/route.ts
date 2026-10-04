import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { sendQuotation } from "@/modules/commerce/quotations";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
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
    return jsonError("VALIDATION_ERROR", "A branch and a quotation are required.", 400);
  }
  const result = await sendQuotation({
    organizationId: auth.session.organizationId,
    branchId: auth.session.branchId,
    userId: auth.session.userId,
    quotationId: id,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id });
}
