import { clientIp, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { writeAudit } from "@/modules/auth/audit";
import { clearSessionCookie } from "@/modules/auth/cookie";
import { loadSession, revokeToken, sessionTokenFromRequest } from "@/modules/auth/session";

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
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
}
