import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { postDirectReturn } from "@/modules/reference/extras";

const bodySchema = z.object({
  productId: z.string().uuid(),
  quantity: z.string(),
  refundAmount: z.string(),
  method: z.enum(["CASH", "BANK"]),
  businessDate: isoDate,
});

export const POST = defineRoute({
  permission: "sales.return",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, a product, a quantity, and a refund are required.", 400);
    }
    const result = await postDirectReturn({ ...actor, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", 201);
  },
});
