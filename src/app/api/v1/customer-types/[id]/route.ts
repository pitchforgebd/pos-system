import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { updateCustomerType } from "@/modules/customers/customers";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(191),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export const PATCH = defineRoute<undefined, { id: string }>({
  permission: "customers.edit",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await updateCustomerType({
      organizationId: session.organizationId,
      actorId: session.userId,
      typeId: id,
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result.type);
  },
});
