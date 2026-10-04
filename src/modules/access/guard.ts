import { jsonError } from "@/lib/api/http";
import { loadSession, sessionTokenFromRequest, type SessionContext } from "@/modules/auth/session";

export async function requireSession(request: Request) {
  const token = sessionTokenFromRequest(request);
  if (!token) {
    return { ok: false as const, response: jsonError("AUTHENTICATION_ERROR", "Sign in is required.", 401) };
  }
  const session = await loadSession(token);
  if (!session) {
    return { ok: false as const, response: jsonError("AUTHENTICATION_ERROR", "Sign in is required.", 401) };
  }
  return { ok: true as const, session };
}

export function requirePermission(session: SessionContext, code: string) {
  if (session.permissions.has(code)) {
    return null;
  }
  return jsonError("AUTHORIZATION_ERROR", "You do not have permission for this action.", 403);
}
