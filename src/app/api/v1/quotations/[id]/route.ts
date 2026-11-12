import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { getOrder } from "@/modules/orders/orders";

export const GET = defineRoute<undefined, { id: string }>({
  permission: "quotations.manage",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!session.branchId || !z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const order = await getOrder(session.organizationId, session.branchId, id);
    if (!order || !order.isQuotation) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(order);
  },
});
