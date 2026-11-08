import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { convertQuotation } from "@/modules/commerce/quotations";
import { idempotencyKey } from "@/modules/inventory/actor";

export const POST = defineRoute<undefined, { id: string }>({
  permission: ["quotations.manage", "sales.create"],
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    if (!session.branchId || !z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A branch and a quotation are required.", 400);
    }
    const result = await convertQuotation({
      organizationId: session.organizationId,
      branchId: session.branchId,
      userId: session.userId,
      idempotencyKey: idempotencyKey(request) ?? undefined,
      quotationId: id,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
