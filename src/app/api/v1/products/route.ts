import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
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
  trackBatch: z.boolean().default(false),
  trackSerial: z.boolean().default(false),
  reorderLevel: z.string().default("0"),
  warrantyAvailable: z.boolean().default(false),
  barcode: z.string().trim().min(1).max(64).optional(),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "products.view");
  if (denied) {
    return denied;
  }
  const search = new URL(request.url).searchParams.get("search")?.trim() || undefined;
  return jsonOk(await listProducts(auth.session.organizationId, search));
}

export async function POST(request: Request) {
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
  const parsed = productSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await createProduct({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    ...parsed.data,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    const code = result.status === 409 ? "CONFLICT" : result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE";
    return jsonError(code, result.message, result.status);
  }
  return jsonOk(result.product, "Operation completed", 201);
}
