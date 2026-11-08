import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { permissionCodes } from "@/lib/permissions/codes";
import { setRolePermissions } from "@/modules/access/roles";

const patchSchema = z.object({
  permissions: z.array(z.string()),
});

export const PATCH = defineRoute<undefined, { id: string }>({
  permission: "roles.manage",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
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
      organizationId: session.organizationId,
      actorId: session.userId,
      roleId: parsedId.data,
      codes: parsed.data.permissions,
      actorCanManageBranches: session.permissions.has("branches.manage"),
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      const code = result.status === 404 ? "NOT_FOUND" : result.status === 403 ? "AUTHORIZATION_ERROR" : "VALIDATION_ERROR";
      return jsonError(code, result.message, result.status);
    }
    return jsonOk({ permissions: result.permissions });
  },
});
