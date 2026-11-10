import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { addVariant } from "@/modules/catalog/products";

const bodySchema = z.object({
  sku: z.string().trim().min(1).max(64),
  price: z.string().optional(),
  barcode: z.string().trim().min(1).max(64).optional(),
  values: z.array(z.object({ headId: z.string().uuid(), valueId: z.string().uuid() })).max(20).optional(),
});

export const POST = defineRoute<undefined, { id: string }>({
  permission: "products.create",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await addVariant({ organizationId: session.organizationId, productId: id, ...parsed.data });
    if (!result.ok) {
      const code = result.status === 409 ? "CONFLICT" : result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE";
      return jsonError(code, result.message, result.status);
    }
    return jsonOk(result.variant, "Operation completed", 201);
  },
});
