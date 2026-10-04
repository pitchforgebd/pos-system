import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { createLoyaltyTier, listLoyaltyTiers } from "@/modules/customers/loyalty";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(191),
  minimumSpend: z.string(),
  discountPercent: z.string(),
  benefits: z.string().trim().max(255).nullable().optional(),
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
  return jsonOk(await listLoyaltyTiers(auth.session.organizationId));
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
  const result = await createLoyaltyTier({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    ...parsed.data,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk(result.tier, "Operation completed", 201);
}
