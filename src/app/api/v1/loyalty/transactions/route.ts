import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { listLoyaltyTransactions, rejectLoyaltyPost } from "@/modules/customers/loyalty";

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "loyalty.manage");
  if (denied) {
    return denied;
  }
  return jsonOk(await listLoyaltyTransactions(auth.session.organizationId));
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
  const denied = requirePermission(auth.session, "loyalty.manage");
  if (denied) {
    return denied;
  }
  const held = rejectLoyaltyPost();
  return jsonError(held.code, held.message, held.status);
}
