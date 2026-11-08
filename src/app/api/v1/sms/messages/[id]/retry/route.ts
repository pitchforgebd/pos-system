import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey } from "@/modules/inventory/actor";
import { retrySms } from "@/modules/sms/sms";

export const POST = defineRoute<undefined, { id: string }>({
  permission: "sms.manage",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const key = idempotencyKey(request);
    if (!key) {
      return jsonError("VALIDATION_ERROR", "An Idempotency-Key is required.", 400);
    }
    const result = await retrySms({
      organizationId: session.organizationId,
      userId: session.userId,
      messageId: id,
      idempotencyKey: key,
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, status: result.status });
  },
});
