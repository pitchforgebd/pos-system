import { clientIp, jsonError } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { writeAudit } from "@/modules/auth/audit";
import { exportProducts } from "@/modules/imports/product-import";

export const GET = defineRoute({
  permission: "products.export",
  handler: async ({ request, session }) => {
    const result = await exportProducts(session.organizationId, { includeCost: session.permissions.has("products.cost") });
    if (!result.ok) {
      return jsonError("BUSINESS_RULE", result.message, result.status);
    }
    await writeAudit({
      organizationId: session.organizationId,
      userId: session.userId,
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
  },
});
