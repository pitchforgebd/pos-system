import { jsonError, jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { getSale } from "@/modules/sales/sales";

export const GET = defineRoute<undefined, { id: string }>({
  permission: "sales.view",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!session.branchId) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const sale = await getSale(session.organizationId, session.branchId, id);
    if (!sale) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(sale);
  },
});
