import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { getProductDetail, savePriceSteps } from "@/modules/catalog/detail";

const bodySchema = z.object({
  variantId: z.string().uuid().nullable().optional(),
  prices: z
    .array(z.object({ level: z.string().trim().min(1).max(64), minQty: z.string(), price: z.string() }))
    .max(200),
});

// The price steps of a product (or one variant): a level, the quantity it starts at, a price. The whole list is replaced.
export const PUT = defineRoute<undefined, { id: string }>({
  permission: "products.edit",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await savePriceSteps({
      organizationId: session.organizationId,
      actorId: session.userId,
      productId: id,
      variantId: parsed.data.variantId ?? null,
      prices: parsed.data.prices,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE", result.message, result.status);
    }
    const detail = await getProductDetail(session.organizationId, id, { cost: session.permissions.has("products.cost") });
    return jsonOk(detail?.levels ?? []);
  },
});
