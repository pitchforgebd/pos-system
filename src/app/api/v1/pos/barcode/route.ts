import { jsonError, jsonOk } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { findRegisterProduct } from "@/modules/catalog/products";

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const canSell = auth.session.permissions.has("sales.create") || auth.session.permissions.has("sales.view");
  if (!canSell) {
    return requirePermission(auth.session, "sales.create") ?? jsonError("AUTHORIZATION_ERROR", "You do not have permission for this action.", 403);
  }
  const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  if (!code || code.length > 64) {
    return jsonError("VALIDATION_ERROR", "Scan a barcode.", 400);
  }
  const product = await findRegisterProduct(auth.session.organizationId, auth.session.branchId, code);
  if (!product) {
    return jsonError("NOT_FOUND", "No product matches that barcode.", 404);
  }
  return jsonOk(product);
}
