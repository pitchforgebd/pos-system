import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { approveRequisition } from "@/modules/commerce/requisitions";

export const POST = defineRoute<undefined, { id: string }>({
  permission: "requisitions.manage",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    if (!session.branchId || !z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A branch and a requisition are required.", 400);
    }
    const result = await approveRequisition({
      organizationId: session.organizationId,
      branchId: session.branchId,
      userId: session.userId,
      requisitionId: id,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id });
  },
});
