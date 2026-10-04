import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { getSmsSettings, saveSmsSettings } from "@/modules/sms/sms";

const bodySchema = z.object({
  sender: z.string(),
  provider: z.string().nullable().optional(),
  unitPrice: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "sms.manage");
  if (denied) {
    return denied;
  }
  return jsonOk(await getSmsSettings(auth.session.organizationId));
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
  const denied = requirePermission(auth.session, "sms.manage");
  if (denied) {
    return denied;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await saveSmsSettings({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    sender: parsed.data.sender,
    provider: parsed.data.provider,
    unitPrice: parsed.data.unitPrice,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ saved: true });
}
