import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { addBarcode } from "@/modules/catalog/products";

const bodySchema = z.object({
  barcode: z.string().trim().min(1).max(64),
  variantId: z.string().uuid().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "products.edit");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await addBarcode({ organizationId: auth.session.organizationId, productId: id, ...parsed.data });
  if (!result.ok) {
    const code = result.status === 409 ? "CONFLICT" : "NOT_FOUND";
    return jsonError(code, result.message, result.status);
  }
  return jsonOk(result.barcode, "Operation completed", 201);
}
