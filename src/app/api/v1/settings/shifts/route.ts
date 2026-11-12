import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonOk } from "@/lib/api/http";
import { setRequireShift } from "@/modules/shifts/shifts";

// POST /api/v1/settings/shifts: whether cash may move only while the user has an open shift (D17).
export const POST = defineRoute({
  permission: "settings.manage",
  body: z.object({ requireShift: z.boolean() }),
  handler: async ({ request, session, body }) => {
    const result = await setRequireShift({ organizationId: session.organizationId, userId: session.userId, ip: clientIp(request), userAgent: request.headers.get("user-agent") }, body.requireShift);
    return jsonOk({ requireShift: result.requireShift }, "Operation completed");
  },
});
