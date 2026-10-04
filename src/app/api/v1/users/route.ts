import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { createUser, listUsers } from "@/modules/access/users";

const createSchema = z.object({
  name: z.string().trim().min(1).max(191),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  roleIds: z.array(z.string().uuid()).default([]),
  branchIds: z.array(z.string().uuid()).default([]),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "users.view");
  if (denied) {
    return denied;
  }
  return jsonOk(await listUsers(auth.session.organizationId));
}

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "users.create");
  if (denied) {
    return denied;
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  if (parsed.data.roleIds.length > 0) {
    const roleDenied = requirePermission(auth.session, "roles.manage");
    if (roleDenied) {
      return roleDenied;
    }
  }
  const result = await createUser({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    name: parsed.data.name,
    email: parsed.data.email,
    password: parsed.data.password,
    roleIds: parsed.data.roleIds,
    branchIds: parsed.data.branchIds,
    actorCanManageBranches: auth.session.permissions.has("branches.manage"),
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    const code = result.status === 409 ? "CONFLICT" : result.status === 403 ? "AUTHORIZATION_ERROR" : "NOT_FOUND";
    return jsonError(code, result.message, result.status);
  }
  return jsonOk(result.user, "Operation completed", 201);
}
