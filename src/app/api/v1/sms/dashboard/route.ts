import { jsonOk } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { smsDashboard } from "@/modules/sms/sms";

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "sms.manage");
  if (denied) {
    return denied;
  }
  return jsonOk(await smsDashboard(auth.session.organizationId));
}
