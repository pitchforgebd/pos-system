import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { addVariant } from "@/modules/catalog/products";

const bodySchema = z.object({
  sku: z.string().trim().min(1).max(64),
  price: z.string().optional(),
  barcode: z.string().trim().min(1).max(64).optional(),
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
  const denied = requirePermission(auth.session, "products.create");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await addVariant({ organizationId: auth.session.organizationId, productId: id, ...parsed.data });
  if (!result.ok) {
    const code = result.status === 409 ? "CONFLICT" : result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE";
    return jsonError(code, result.message, result.status);
  }
  return jsonOk(result.variant, "Operation completed", 201);
}
