import { jsonError, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "sales.cancel");
  if (denied) {
    return denied;
  }
  return jsonError("BUSINESS_RULE", "A posted sale is not cancelled in this phase.", 422);
}
