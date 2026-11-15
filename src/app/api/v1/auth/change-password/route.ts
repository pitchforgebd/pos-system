import { z } from "zod";

import { defineRoute } from "@/core/http/define-route";
import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { changePassword } from "@/modules/auth/change-password";
import { PASSWORD_MAX } from "@/modules/auth/password-policy";

// POST /api/v1/auth/change-password: the signed-in user changes their own password. Any signed-in user may (no permission code); the old password is
// required, every other session of the user ends. The new password's rules are checked inside (length, common passwords, own name or email).
export const POST = defineRoute({
  // a password hash takes a moment and must not hold a database transaction open
  transaction: false,
  body: z.object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX),
    newPassword: z.string().min(1).max(PASSWORD_MAX),
  }),
  handler: async ({ request, session, body }) => {
    const result = await changePassword({
      userId: session.userId,
      organizationId: session.organizationId,
      sessionId: session.sessionId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.status === 429 ? "RATE_LIMITED" : "VALIDATION_ERROR", result.message, result.status, result.field ? { [result.field]: result.message } : {});
    }
    return jsonOk({ endedSessions: result.endedSessions }, "Password was changed. Your other sign-ins were ended.");
  },
});
