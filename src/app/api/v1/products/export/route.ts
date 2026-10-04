import { clientIp, jsonError } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { writeAudit } from "@/modules/auth/audit";
import { exportProducts } from "@/modules/imports/product-import";

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "products.export");
  if (denied) {
    return denied;
  }
  const result = await exportProducts(auth.session.organizationId);
  if (!result.ok) {
    return jsonError("BUSINESS_RULE", result.message, result.status);
  }
  await writeAudit({
    organizationId: auth.session.organizationId,
    userId: auth.session.userId,
    action: "export",
    module: "products",
    entityType: "product",
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  return new Response(result.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="products.csv"',
    },
  });
}
