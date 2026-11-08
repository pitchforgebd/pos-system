import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { fileClaim } from "@/modules/reference/extras";

const bodySchema = z.object({
  productId: z.string().uuid(),
  customerId: z.string().uuid(),
  serial: z.string().trim().max(64).optional(),
  note: z.string().trim().min(1).max(255),
});

export const POST = defineRoute({
  permission: "products.edit",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, a product, a customer, and a note are required.", 400);
    }
    const result = await fileClaim({ ...actor, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", 201);
  },
});
