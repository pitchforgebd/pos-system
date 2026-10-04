import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { permissionCodes } from "@/lib/permissions/codes";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { setRolePermissions } from "@/modules/access/roles";

const patchSchema = z.object({
  permissions: z.array(z.string()),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "roles.manage");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const known = new Set<string>(permissionCodes);
  if (parsed.data.permissions.some((code) => !known.has(code))) {
    return jsonError("VALIDATION_ERROR", "Unknown permission code.", 400);
  }
  const result = await setRolePermissions({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    roleId: parsedId.data,
    codes: parsed.data.permissions,
    actorCanManageBranches: auth.session.permissions.has("branches.manage"),
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    const code = result.status === 404 ? "NOT_FOUND" : result.status === 403 ? "AUTHORIZATION_ERROR" : "VALIDATION_ERROR";
    return jsonError(code, result.message, result.status);
  }
  return jsonOk({ permissions: result.permissions });
}
