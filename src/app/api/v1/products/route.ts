import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createProduct, listProducts } from "@/modules/catalog/products";

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
  barcode: z.string().trim().min(1).max(64).optional(),
});

export const GET = defineRoute({
  permission: "products.view",
  handler: async ({ request, session }) => {
    const search = new URL(request.url).searchParams.get("search")?.trim() || undefined;
    return jsonOk(await listProducts(session.organizationId, search));
  },
});

export const POST = defineRoute({
  permission: "products.create",
  handler: async ({ request, session }) => {
    const parsed = productSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createProduct({
      organizationId: session.organizationId,
      actorId: session.userId,
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      const code = result.status === 409 ? "CONFLICT" : result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE";
      return jsonError(code, result.message, result.status);
    }
    return jsonOk(result.product, "Operation completed", 201);
  },
});
