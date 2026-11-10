import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { createVariationHead, listVariationHeads } from "@/modules/catalog/variations";

export const GET = defineRoute({
  permission: "products.view",
  handler: async ({ session }) => jsonOk(await listVariationHeads(session.organizationId)),
});

export const POST = defineRoute({
  permission: "products.edit",
  handler: async ({ request, session }) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(191) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createVariationHead({ organizationId: session.organizationId, name: parsed.data.name });
    if (!result.ok) {
      return jsonError(result.status === 409 ? "CONFLICT" : "BUSINESS_RULE", result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", 201);
  },
});
