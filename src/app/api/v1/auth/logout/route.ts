import { clientIp, jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { writeAudit } from "@/modules/auth/audit";
import { clearSessionCookie } from "@/modules/auth/cookie";
import { loadSession, revokeToken, sessionTokenFromRequest } from "@/modules/auth/session";

export const POST = defineRoute({
  public: true,
  transaction: false,
  handler: async ({ request }) => {
    const token = sessionTokenFromRequest(request);
    if (token) {
      const session = await loadSession(token);
      await revokeToken(token);
      if (session) {
        await writeAudit({
          organizationId: session.organizationId,
          branchId: session.branchId,
          userId: session.userId,
          action: "logout",
          module: "auth",
          entityType: "session",
          entityId: session.sessionId,
          ip: clientIp(request),
          userAgent: request.headers.get("user-agent"),
        });
      }
    }
    return clearSessionCookie(jsonOk({ signedOut: true }));
  },
});
