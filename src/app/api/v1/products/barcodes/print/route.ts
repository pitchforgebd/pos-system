import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { recordBarcodePrint } from "@/modules/catalog/barcodes";

const bodySchema = z.object({
  barcodeId: z.string().uuid(),
  copies: z.number().int(),
});

export const POST = defineRoute({
  permission: "products.view",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await recordBarcodePrint({
      organizationId: session.organizationId,
      userId: session.userId,
      barcodeId: parsed.data.barcodeId,
      copies: parsed.data.copies,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE", result.message, result.status);
    }
    return jsonOk(result);
  },
});
