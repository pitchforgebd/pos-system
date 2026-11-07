import { z } from "zod";
import { isoDate } from "@/core/time/iso-date";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { createLoyaltyCard, listLoyaltyCards } from "@/modules/customers/loyalty";

const bodySchema = z.object({
  customerId: z.string().uuid(),
  tierId: z.string().uuid().nullable().optional(),
  number: z.string().trim().min(1).max(64),
  cardType: z.string().trim().min(1).max(32),
  issuedOn: isoDate,
  expiresOn: isoDate.nullable().optional(),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "loyalty.manage");
  if (denied) {
    return denied;
  }
  return jsonOk(await listLoyaltyCards(auth.session.organizationId));
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
  const denied = requirePermission(auth.session, "loyalty.manage");
  if (denied) {
    return denied;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await createLoyaltyCard({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    ...parsed.data,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk(result.card, "Operation completed", 201);
}
