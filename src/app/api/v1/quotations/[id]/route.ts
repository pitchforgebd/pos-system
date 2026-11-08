import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { getQuotation } from "@/modules/commerce/quotations";

export const GET = defineRoute<undefined, { id: string }>({
  permission: "quotations.manage",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!session.branchId || !z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const quotation = await getQuotation(session.organizationId, session.branchId, id);
    if (!quotation) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(quotation);
  },
});
