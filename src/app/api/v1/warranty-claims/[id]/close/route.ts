import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { closeClaim } from "@/modules/reference/extras";

export const POST = defineRoute<undefined, { id: string }>({
  permission: "products.edit",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A claim is required.", 400);
    }
    const result = await closeClaim({ organizationId: session.organizationId, claimId: id });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id });
  },
});
