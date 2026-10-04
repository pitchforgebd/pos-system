import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { disableProduct, getProduct, updateProduct } from "@/modules/catalog/products";

const productSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(191),
  description: z.string().trim().max(5000).nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  purchasePrice: z.string(),
  sellingPrice: z.string(),
  wholesalePrice: z.string(),
  minimumPrice: z.string(),
  vatType: z.string().trim().max(32).nullable().optional(),
  vatValue: z.string().nullable().optional(),
  trackStock: z.boolean().default(true),
  trackExpiry: z.boolean().default(false),
  trackBatch: z.boolean().default(false),
  trackSerial: z.boolean().default(false),
  reorderLevel: z.string().default("0"),
  warrantyAvailable: z.boolean().default(false),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "products.view");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const product = await getProduct(auth.session.organizationId, id);
  if (!product) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  return jsonOk(product);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
  const parsed = productSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await updateProduct({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    productId: id,
    ...parsed.data,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    const code = result.status === 409 ? "CONFLICT" : result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE";
    return jsonError(code, result.message, result.status);
  }
  return jsonOk(result.product);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "products.delete");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const result = await disableProduct({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    productId: id,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError("NOT_FOUND", result.message, 404);
  }
  return jsonOk({ id });
}
