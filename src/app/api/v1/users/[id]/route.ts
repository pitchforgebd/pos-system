import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { disableUser, getUser, replaceUserRoles, updateUser } from "@/modules/access/users";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(191).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  status: z.literal("DISABLED").optional(),
  branchIds: z.array(z.string().uuid()).optional(),
  roleIds: z.array(z.string().uuid()).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "users.view");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const user = await getUser(auth.session.organizationId, parsedId.data);
  if (!user) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  return jsonOk(user);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
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
  const changes = parsed.data;
  const editsProfile = changes.name !== undefined || changes.phone !== undefined || changes.branchIds !== undefined;
  if (editsProfile) {
    const denied = requirePermission(auth.session, "users.edit");
    if (denied) {
      return denied;
    }
  }
  if (changes.status === "DISABLED") {
    const denied = requirePermission(auth.session, "users.disable");
    if (denied) {
      return denied;
    }
  }
  if (changes.roleIds) {
    const denied = requirePermission(auth.session, "roles.manage");
    if (denied) {
      return denied;
    }
  }
  if (!editsProfile && !changes.status && !changes.roleIds) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const actor = {
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    userId: parsedId.data,
    actorCanManageBranches: auth.session.permissions.has("branches.manage"),
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  };
  if (editsProfile) {
    const updated = await updateUser({ ...actor, name: changes.name, phone: changes.phone, branchIds: changes.branchIds });
    if (!updated.ok) {
      const code = updated.status === 403 ? "AUTHORIZATION_ERROR" : "NOT_FOUND";
      return jsonError(code, updated.message, updated.status);
    }
  }
  if (changes.roleIds) {
    const updated = await replaceUserRoles({ ...actor, roleIds: changes.roleIds });
    if (!updated.ok) {
      const code = updated.status === 404 ? "NOT_FOUND" : updated.status === 403 ? "AUTHORIZATION_ERROR" : "VALIDATION_ERROR";
      return jsonError(code, updated.message, updated.status);
    }
  }
  if (changes.status === "DISABLED") {
    const updated = await disableUser(actor);
    if (!updated.ok) {
      const code = updated.status === 403 ? "AUTHORIZATION_ERROR" : "NOT_FOUND";
      return jsonError(code, updated.message, updated.status);
    }
  }
  const user = await getUser(auth.session.organizationId, parsedId.data);
  return jsonOk(user);
}
