import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { createRole, listRoles } from "@/modules/access/roles";

const createSchema = z.object({
  name: z.string().trim().min(1).max(191),
  note: z.string().trim().max(255).optional(),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "roles.manage");
  if (denied) {
    return denied;
  }
  return jsonOk(await listRoles(auth.session.organizationId));
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
  const denied = requirePermission(auth.session, "roles.manage");
  if (denied) {
    return denied;
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await createRole({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    name: parsed.data.name,
    note: parsed.data.note,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError("CONFLICT", result.message, result.status);
  }
  return jsonOk(result.role, "Operation completed", 201);
}
