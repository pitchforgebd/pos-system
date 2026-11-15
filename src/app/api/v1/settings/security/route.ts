import { z } from "zod";

import { defineRoute } from "@/core/http/define-route";
import { clientIp, jsonOk } from "@/lib/api/http";
import { getSecuritySettings, IDLE_MAX_MINUTES, IDLE_MIN_MINUTES, setIdleTimeout } from "@/modules/settings/security";

export const GET = defineRoute({
  permission: "settings.manage",
  handler: async ({ session }) => jsonOk(await getSecuritySettings(session.organizationId)),
});

// POST /api/v1/settings/security: how many minutes of doing nothing sign a user out (N20).
export const POST = defineRoute({
  permission: "settings.manage",
  body: z.object({ idleTimeoutMinutes: z.number().int().min(IDLE_MIN_MINUTES).max(IDLE_MAX_MINUTES) }),
  handler: async ({ request, session, body }) => {
    const result = await setIdleTimeout({ organizationId: session.organizationId, userId: session.userId, ip: clientIp(request), userAgent: request.headers.get("user-agent") }, body.idleTimeoutMinutes);
    return jsonOk(result);
  },
});
