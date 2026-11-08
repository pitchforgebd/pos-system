import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createLoyaltyTier, listLoyaltyTiers } from "@/modules/customers/loyalty";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(191),
  minimumSpend: z.string(),
  discountPercent: z.string(),
  benefits: z.string().trim().max(255).nullable().optional(),
});

export const GET = defineRoute({
  permission: "loyalty.manage",
  handler: async ({ session }) => {
    return jsonOk(await listLoyaltyTiers(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "loyalty.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createLoyaltyTier({
      organizationId: session.organizationId,
      actorId: session.userId,
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result.tier, "Operation completed", 201);
  },
});
