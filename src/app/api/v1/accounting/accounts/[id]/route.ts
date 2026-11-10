import { z } from "zod";

import { defineRoute } from "@/core/http/define-route";
import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { deleteAccount, setAccountStatus } from "@/modules/accounting/accounts";

const idSchema = z.string().uuid();

// A system account (one a posting rule relies on) answers 422 to both: it cannot be closed or deleted (N27).

export const PATCH = defineRoute<{ status: "ACTIVE" | "INACTIVE" }, { id: string }>({
  permission: "accounting.create",
  body: z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) }),
  handler: async ({ request, session, params, body }) => {
    if (!idSchema.safeParse(params.id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const account = await setAccountStatus({
      organizationId: session.organizationId,
      userId: session.userId,
      branchId: session.branchId,
      accountId: params.id,
      status: body.status,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonOk(account);
  },
});

export const DELETE = defineRoute<undefined, { id: string }>({
  permission: "accounting.create",
  handler: async ({ request, session, params }) => {
    if (!idSchema.safeParse(params.id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const deleted = await deleteAccount({
      organizationId: session.organizationId,
      userId: session.userId,
      branchId: session.branchId,
      accountId: params.id,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonOk(deleted);
  },
});
