import { defineRoute } from "@/core/http/define-route";

import { jsonOk } from "@/lib/api/http";
import { companyWorth } from "@/modules/assets/worth";

// GET /api/v1/company-worth: what the company owns and owes, each from the books, and the net.
export const GET = defineRoute({
  permission: "accounting.view",
  handler: async ({ session }) => jsonOk(await companyWorth(session.organizationId)),
});
