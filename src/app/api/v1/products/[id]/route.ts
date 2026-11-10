import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
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
  trackSerial: z.boolean().default(false),
  reorderLevel: z.string().default("0"),
  warrantyAvailable: z.boolean().default(false),
});

export const GET = defineRoute<undefined, { id: string }>({
  permission: "products.view",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const product = await getProduct(session.organizationId, id);
    if (!product) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(product);
  },
});

export const PATCH = defineRoute<undefined, { id: string }>({
  permission: "products.edit",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    const parsed = productSchema.safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await updateProduct({
      organizationId: session.organizationId,
      actorId: session.userId,
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
  },
});

export const DELETE = defineRoute<undefined, { id: string }>({
  permission: "products.delete",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const result = await disableProduct({
      organizationId: session.organizationId,
      actorId: session.userId,
      productId: id,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError("NOT_FOUND", result.message, 404);
    }
    return jsonOk({ id });
  },
});
