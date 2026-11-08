import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createLoyaltyCard, listLoyaltyCards } from "@/modules/customers/loyalty";

const bodySchema = z.object({
  customerId: z.string().uuid(),
  tierId: z.string().uuid().nullable().optional(),
  number: z.string().trim().min(1).max(64),
  cardType: z.string().trim().min(1).max(32),
  issuedOn: isoDate,
  expiresOn: isoDate.nullable().optional(),
});

export const GET = defineRoute({
  permission: "loyalty.manage",
  handler: async ({ session }) => {
    return jsonOk(await listLoyaltyCards(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "loyalty.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createLoyaltyCard({
      organizationId: session.organizationId,
      actorId: session.userId,
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result.card, "Operation completed", 201);
  },
});
