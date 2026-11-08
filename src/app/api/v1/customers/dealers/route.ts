import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { markDealer } from "@/modules/reference/extras";

const bodySchema = z.object({ customerId: z.string().uuid() });

export const POST = defineRoute({
  permission: "customers.edit",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "A customer is required.", 400);
    }
    const result = await markDealer({ organizationId: session.organizationId, customerId: parsed.data.customerId });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id });
  },
});
