import { z } from "zod";
import { RuleError } from "@/core/errors/rule-error";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { previewSale } from "@/modules/sales/sales";

const line = z.object({
  productId: z.string().uuid().optional(),
  barcode: z.string().trim().min(1).max(64).optional(),
  variantId: z.string().uuid().optional(),
  quantity: z.string().max(24),
  unitPrice: z.string().max(24).optional(),
  discountAmount: z.string().max(24).optional(),
  discountPercent: z.string().max(8).optional(),
});

const body = z.object({
  customerId: z.string().uuid().optional(),
  level: z.string().trim().max(64).optional(),
  headerDiscount: z.string().max(24).optional(),
  chargesTotal: z.string().max(24).optional(),
  lines: z.array(line).min(1).max(100),
});

// POST /api/v1/sales/preview: what the sale would come to, worked out as posting it will. Saves nothing (not a write, so no key).
export const POST = defineRoute({
  permission: "sales.create",
  transaction: false,
  handler: async ({ request, session }) => {
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    try {
      return jsonOk(
        await previewSale({
          organizationId: session.organizationId,
          ...parsed.data,
          allowDiscount: session.permissions.has("sales.discount"),
          allowPriceOverride: session.permissions.has("sales.price_override"),
          allowPriceLevel: session.permissions.has("sales.price_level"),
        }),
      );
    } catch (error) {
      if (error instanceof RuleError) {
        return jsonError("BUSINESS_RULE", error.message, error.status);
      }
      throw error;
    }
  },
});
