import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { closeClaim } from "@/modules/reference/extras";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "products.edit");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError("VALIDATION_ERROR", "A claim is required.", 400);
  }
  const result = await closeClaim({ organizationId: auth.session.organizationId, claimId: id });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id });
}
