import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { getOrganizationProfile, saveOrganizationProfile } from "@/modules/settings/profile";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(191),
  phone: z.string().trim().max(64).nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  bin: z.string().trim().max(64).nullable().optional(),
  tin: z.string().trim().max(64).nullable().optional(),
  logoUrl: z.string().trim().max(255).nullable().optional(),
  pointsPerHundred: z.string().trim().max(32).nullable().optional(),
  takaPerPoint: z.string().trim().max(32).nullable().optional(),
  booksStartOn: z.string().trim().max(10).nullable().optional(),
});

export const GET = defineRoute({
  permission: "settings.manage",
  handler: async ({ session }) => {
    const profile = await getOrganizationProfile(session.organizationId);
    if (!profile) {
      return jsonError("NOT_FOUND", "That shop was not found.", 404);
    }
    return jsonOk(profile);
  },
});

export const POST = defineRoute({
  permission: "settings.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await saveOrganizationProfile({
      organizationId: session.organizationId,
      actorId: session.userId,
      name: parsed.data.name,
      phone: parsed.data.phone,
      address: parsed.data.address,
      bin: parsed.data.bin,
      tin: parsed.data.tin,
      logoUrl: parsed.data.logoUrl,
      pointsPerHundred: parsed.data.pointsPerHundred,
      takaPerPoint: parsed.data.takaPerPoint,
      booksStartOn: parsed.data.booksStartOn,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ saved: true });
  },
});
