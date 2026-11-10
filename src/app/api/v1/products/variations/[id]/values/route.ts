import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { addVariationValue, removeVariationValue } from "@/modules/catalog/variations";

// POST adds a value to the variation with this id; DELETE ?valueId=... removes one value of it.
export const POST = defineRoute<undefined, { id: string }>({
  permission: "products.edit",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    const parsed = z.object({ value: z.string().trim().min(1).max(191) }).safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await addVariationValue({ organizationId: session.organizationId, headId: id, value: parsed.data.value });
    if (!result.ok) {
      return jsonError(result.status === 409 ? "CONFLICT" : result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE", result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", 201);
  },
});

export const DELETE = defineRoute<undefined, { id: string }>({
  permission: "products.edit",
  handler: async ({ request, session }) => {
    const valueId = new URL(request.url).searchParams.get("valueId") ?? "";
    if (!z.string().uuid().safeParse(valueId).success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await removeVariationValue({ organizationId: session.organizationId, valueId });
    if (!result.ok) {
      return jsonError(result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE", result.message, result.status);
    }
    return jsonOk({ id: valueId });
  },
});
