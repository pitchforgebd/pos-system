import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { writeAudit } from "@/modules/auth/audit";
import { requireSession } from "@/modules/access/guard";
import { findOrganizationBranch, setSessionBranch } from "@/modules/auth/session";

const bodySchema = z.object({
  branchId: z.string().uuid(),
});

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const branch = await findOrganizationBranch(auth.session.organizationId, parsed.data.branchId);
  if (!branch) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  if (!auth.session.branchIds.has(branch.id)) {
    return jsonError("AUTHORIZATION_ERROR", "You do not have access to that branch.", 403);
  }
  await setSessionBranch(auth.session.sessionId, branch.id);
  await writeAudit({
    organizationId: auth.session.organizationId,
    branchId: branch.id,
    userId: auth.session.userId,
    action: "update",
    module: "auth",
    entityType: "session",
    entityId: auth.session.sessionId,
    after: { branchId: branch.id },
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  return jsonOk({ branchId: branch.id, name: branch.name });
}
