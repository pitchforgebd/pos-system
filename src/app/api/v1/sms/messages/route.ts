import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { idempotencyKey } from "@/modules/inventory/actor";
import { listMessages, sendSms } from "@/modules/sms/sms";
import { smsVariables } from "@/modules/sms/templates";

const variableSchema = z.object(Object.fromEntries(smsVariables.map((name) => [name, z.string().max(191).optional()]))).strict();

const bodySchema = z.object({
  recipient: z.string(),
  templateId: z.string().uuid().nullable().optional(),
  body: z.string().nullable().optional(),
  variables: variableSchema.optional(),
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
  return jsonOk(await listMessages(auth.session.organizationId));
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
  const key = idempotencyKey(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!key || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "An Idempotency-Key and a message are required.", 400);
  }
  const variables = Object.fromEntries(Object.entries(parsed.data.variables ?? {}).filter((entry) => entry[1] !== undefined)) as Record<string, string>;
  const result = await sendSms({
    organizationId: auth.session.organizationId,
    userId: auth.session.userId,
    idempotencyKey: key,
    recipient: parsed.data.recipient,
    templateId: parsed.data.templateId,
    body: parsed.data.body,
    variables,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id, status: result.status, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
}
