import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { getOrganizationProfile, saveOrganizationProfile } from "@/modules/settings/profile";

const bodySchema = z.object({
  name: z.string(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  bin: z.string().nullable().optional(),
  tin: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  pointsPerHundred: z.string().nullable().optional(),
  takaPerPoint: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "settings.manage");
  if (denied) {
    return denied;
  }
  const profile = await getOrganizationProfile(auth.session.organizationId);
  if (!profile) {
    return jsonError("NOT_FOUND", "That shop was not found.", 404);
  }
  return jsonOk(profile);
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
  const denied = requirePermission(auth.session, "settings.manage");
  if (denied) {
    return denied;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await saveOrganizationProfile({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    name: parsed.data.name,
    phone: parsed.data.phone,
    address: parsed.data.address,
    bin: parsed.data.bin,
    tin: parsed.data.tin,
    logoUrl: parsed.data.logoUrl,
    pointsPerHundred: parsed.data.pointsPerHundred,
    takaPerPoint: parsed.data.takaPerPoint,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ saved: true });
}
