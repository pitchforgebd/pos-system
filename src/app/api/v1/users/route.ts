import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { requirePermission } from "@/modules/access/guard";
import { createUser, listUsers } from "@/modules/access/users";

const createSchema = z.object({
  name: z.string().trim().min(1).max(191),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  roleIds: z.array(z.string().uuid()).default([]),
  branchIds: z.array(z.string().uuid()).default([]),
});

export const GET = defineRoute({
  permission: "users.view",
  handler: async ({ session }) => {
    return jsonOk(await listUsers(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "users.create",
  handler: async ({ request, session }) => {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    if (parsed.data.roleIds.length > 0) {
      const roleDenied = requirePermission(session, "roles.manage");
      if (roleDenied) {
        return roleDenied;
      }
    }
    const result = await createUser({
      organizationId: session.organizationId,
      actorId: session.userId,
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      roleIds: parsed.data.roleIds,
      branchIds: parsed.data.branchIds,
      actorCanManageBranches: session.permissions.has("branches.manage"),
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      const code = result.status === 409 ? "CONFLICT" : result.status === 403 ? "AUTHORIZATION_ERROR" : "NOT_FOUND";
      return jsonError(code, result.message, result.status);
    }
    return jsonOk(result.user, "Operation completed", 201);
  },
});
