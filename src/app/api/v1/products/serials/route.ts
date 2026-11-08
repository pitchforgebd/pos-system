import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { addSerial } from "@/modules/reference/extras";

const bodySchema = z.object({
  productId: z.string().uuid(),
  serial: z.string().trim().min(1).max(64),
});

export const POST = defineRoute({
  permission: "products.edit",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, a serial product, and an IMEI are required.", 400);
    }
    const result = await addSerial({ ...actor, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", 201);
  },
});
