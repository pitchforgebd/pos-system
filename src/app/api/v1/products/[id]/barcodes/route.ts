import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { generateBarcode } from "@/modules/catalog/ean13";
import { addBarcode } from "@/modules/catalog/products";

// Either a barcode to add, or generate: true for a new EAN-13 of the shop's own.
const bodySchema = z.union([
  z.object({ barcode: z.string().trim().min(1).max(64), variantId: z.string().uuid().optional() }),
  z.object({ generate: z.literal(true), variantId: z.string().uuid().optional() }),
]);

export const POST = defineRoute<undefined, { id: string }>({
  permission: "products.edit",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result =
      "generate" in parsed.data
        ? await generateBarcode({ organizationId: session.organizationId, productId: id, variantId: parsed.data.variantId })
        : await addBarcode({ organizationId: session.organizationId, productId: id, ...parsed.data });
    if (!result.ok) {
      const code = result.status === 409 ? "CONFLICT" : result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE";
      return jsonError(code, result.message, result.status);
    }
    return jsonOk(result.barcode, "Operation completed", 201);
  },
});
