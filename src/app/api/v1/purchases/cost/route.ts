import { z } from "zod";
import { RuleError } from "@/core/errors/rule-error";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { previewPurchase } from "@/modules/purchasing/purchases";
import { purchaseLineBody } from "@/modules/purchasing/schema";

const body = z.object({
  headerDiscount: z.string().max(24).optional(),
  transportCost: z.string().max(24).optional(),
  otherCost: z.string().max(24).optional(),
  lines: z.array(purchaseLineBody.pick({ quantity: true, unitCost: true, discount: true, vatRate: true }).extend({ productId: z.string().optional() })).min(1).max(200),
});

// POST /api/v1/purchases/cost: what the purchase would cost, worked out as receiving it will. Saves nothing (not a write, so no key).
export const POST = defineRoute({
  permission: "purchase.create",
  csrf: true,
  transaction: false,
  handler: async ({ request }) => {
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    try {
      return jsonOk(previewPurchase({ ...parsed.data, lines: parsed.data.lines.map((line) => ({ ...line, productId: line.productId ?? "" })) }));
    } catch (error) {
      if (error instanceof RuleError) {
        return jsonError("BUSINESS_RULE", error.message, error.status);
      }
      throw error;
    }
  },
});
