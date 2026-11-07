import { z } from "zod";
import { isoDate } from "@/core/time/iso-date";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { createCrmActivity } from "@/modules/customers/crm";

const bodySchema = z.object({
  contactId: z.string().uuid(),
  occurredOn: isoDate,
  note: z.string().trim().min(1).max(255),
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
  const denied = requirePermission(auth.session, "crm.manage");
  if (denied) {
    return denied;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await createCrmActivity({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    ...parsed.data,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk(result.activity, "Operation completed", 201);
}
