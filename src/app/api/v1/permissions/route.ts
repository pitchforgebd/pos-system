import { jsonOk } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { listPermissionCatalog } from "@/modules/access/roles";

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "roles.manage");
  if (denied) {
    return denied;
  }
  return jsonOk(await listPermissionCatalog());
}
