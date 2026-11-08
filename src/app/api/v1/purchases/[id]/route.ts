import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { getPurchase } from "@/modules/purchasing/purchases";

export const GET = defineRoute<undefined, { id: string }>({
  permission: "purchase.view",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    if (!session.branchId) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const purchase = await getPurchase(session.organizationId, session.branchId, id);
    if (!purchase) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(purchase);
  },
});
