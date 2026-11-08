import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { getRequisition } from "@/modules/commerce/requisitions";

export const GET = defineRoute<undefined, { id: string }>({
  permission: "requisitions.manage",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!session.branchId || !z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const requisition = await getRequisition(session.organizationId, session.branchId, id);
    if (!requisition) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(requisition);
  },
});
