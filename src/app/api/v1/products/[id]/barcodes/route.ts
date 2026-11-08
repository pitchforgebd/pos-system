import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { addBarcode } from "@/modules/catalog/products";

const bodySchema = z.object({
  barcode: z.string().trim().min(1).max(64),
  variantId: z.string().uuid().optional(),
});

export const POST = defineRoute<undefined, { id: string }>({
  permission: "products.edit",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await addBarcode({ organizationId: session.organizationId, productId: id, ...parsed.data });
    if (!result.ok) {
      const code = result.status === 409 ? "CONFLICT" : "NOT_FOUND";
      return jsonError(code, result.message, result.status);
    }
    return jsonOk(result.barcode, "Operation completed", 201);
  },
});
