import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { createBranch, listCompanyBranches } from "@/modules/access/branches";

const bodySchema = z.object({
  name: z.string(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "branches.manage");
  if (denied) {
    return denied;
  }
  return jsonOk(await listCompanyBranches(auth.session.organizationId));
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
  const denied = requirePermission(auth.session, "branches.manage");
  if (denied) {
    return denied;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await createBranch({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    name: parsed.data.name,
    phone: parsed.data.phone,
    address: parsed.data.address,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    const code = result.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
    return jsonError(code, result.message, result.status);
  }
  return jsonOk({ id: result.branch.id }, "Branch created", 201);
}
