import { jsonError, jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { requirePermission } from "@/modules/access/guard";
import { findRegisterProduct } from "@/modules/catalog/products";

export const GET = defineRoute({
  handler: async ({ request, session }) => {
    const canSell = session.permissions.has("sales.create") || session.permissions.has("sales.view");
    if (!canSell) {
      return requirePermission(session, "sales.create") ?? jsonError("AUTHORIZATION_ERROR", "You do not have permission for this action.", 403);
    }
    const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
    if (!code || code.length > 64) {
      return jsonError("VALIDATION_ERROR", "Scan a barcode.", 400);
    }
    const product = await findRegisterProduct(session.organizationId, session.branchId, code);
    if (!product) {
      return jsonError("NOT_FOUND", "No product matches that barcode.", 404);
    }
    return jsonOk(product);
  },
});
