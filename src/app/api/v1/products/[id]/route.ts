import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { disableProduct, getProduct, hideCost, updateProduct } from "@/modules/catalog/products";
import { getProductDetail } from "@/modules/catalog/detail";

const productSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(191),
  description: z.string().trim().max(5000).nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  /** Left out (or ignored) for someone without products.cost: the price on file stays. */
  purchasePrice: z.string().optional(),
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
  isService: z.boolean().default(false),
  genericName: z.string().trim().max(191).nullable().optional(),
});

export const GET = defineRoute<undefined, { id: string }>({
  permission: "products.view",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const canSeeCost = session.permissions.has("products.cost");
    if (new URL(request.url).searchParams.get("detail") === "1") {
      const detail = await getProductDetail(session.organizationId, id, { cost: canSeeCost });
      return detail ? jsonOk(detail) : jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const product = await getProduct(session.organizationId, id);
    if (!product) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(canSeeCost ? product : hideCost(product));
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
    // What the product cost is only changed by someone who may see it (D20); for everyone else the price on file stays.
    let purchasePrice = session.permissions.has("products.cost") ? parsed.data.purchasePrice : undefined;
    if (purchasePrice === undefined) {
      purchasePrice = (await getProduct(session.organizationId, id))?.purchasePrice;
    }
    if (purchasePrice === undefined) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const result = await updateProduct({
      organizationId: session.organizationId,
      actorId: session.userId,
      productId: id,
      ...parsed.data,
      purchasePrice,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      const code = result.status === 409 ? "CONFLICT" : result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE";
      return jsonError(code, result.message, result.status);
    }
    return jsonOk(session.permissions.has("products.cost") ? result.product : hideCost(result.product));
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
