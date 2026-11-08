import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { writeAudit } from "@/modules/auth/audit";
import { findOrganizationBranch, setSessionBranch } from "@/modules/auth/session";

const bodySchema = z.object({
  branchId: z.string().uuid(),
});

export const POST = defineRoute({
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const branch = await findOrganizationBranch(session.organizationId, parsed.data.branchId);
    if (!branch) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    if (!session.branchIds.has(branch.id)) {
      return jsonError("AUTHORIZATION_ERROR", "You do not have access to that branch.", 403);
    }
    await setSessionBranch(session.sessionId, branch.id);
    await writeAudit({
      organizationId: session.organizationId,
      branchId: branch.id,
      userId: session.userId,
      action: "update",
      module: "auth",
      entityType: "session",
      entityId: session.sessionId,
      after: { branchId: branch.id },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonOk({ branchId: branch.id, name: branch.name });
  },
});
