import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { removeVariationHead } from "@/modules/catalog/variations";

export const DELETE = defineRoute<undefined, { id: string }>({
  permission: "products.edit",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const result = await removeVariationHead({ organizationId: session.organizationId, headId: id });
    if (!result.ok) {
      return jsonError(result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE", result.message, result.status);
    }
    return jsonOk({ id });
  },
});
