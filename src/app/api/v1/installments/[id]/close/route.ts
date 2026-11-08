import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { closeInstallment } from "@/modules/customers/installments";

export const POST = defineRoute<undefined, { id: string }>({
  permission: "customers.edit",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const result = await closeInstallment({
      organizationId: session.organizationId,
      actorId: session.userId,
      installmentId: id,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id });
  },
});
