import { clientIp } from "@/lib/api/http";
import type { SessionContext } from "@/modules/auth/session";

export function stockActor(session: SessionContext, request: Request) {
  if (!session.branchId || !session.branchIds.has(session.branchId)) {
    return null;
  }
  return {
    organizationId: session.organizationId,
    branchId: session.branchId,
    userId: session.userId,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  };
}

export function idempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  return /^[0-9a-f-]{36}$/i.test(key) ? key : null;
}
