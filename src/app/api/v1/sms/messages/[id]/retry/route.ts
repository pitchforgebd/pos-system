import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { idempotencyKey } from "@/modules/inventory/actor";
import { retrySms } from "@/modules/sms/sms";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "sms.manage");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const key = idempotencyKey(request);
  if (!key) {
    return jsonError("VALIDATION_ERROR", "An Idempotency-Key is required.", 400);
  }
  const result = await retrySms({
    organizationId: auth.session.organizationId,
    userId: auth.session.userId,
    messageId: id,
    idempotencyKey: key,
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id, status: result.status });
}
