import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { orderBoard } from "@/modules/orders/orders";

// GET /api/v1/orders/board: for each status the number of orders and the latest cards.
export const GET = defineRoute({
  permission: "orders.view",
  handler: async ({ session }) => {
    if (!session.branchId) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing orders.", 422);
    }
    return jsonOk(await orderBoard(session.organizationId, session.branchId));
  },
});
