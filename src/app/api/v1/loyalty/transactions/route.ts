import { jsonError, jsonOk } from "@/lib/api/http";
import { defineRoute } from "@/core/http/define-route";
import { listLoyaltyTransactions, rejectLoyaltyPost } from "@/modules/customers/loyalty";

export const GET = defineRoute({
  permission: "loyalty.manage",
  handler: async ({ session }) => {
    return jsonOk(await listLoyaltyTransactions(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "loyalty.manage",
  handler: async ({  }) => {
    const held = rejectLoyaltyPost();
    return jsonError(held.code, held.message, held.status);
  },
});
