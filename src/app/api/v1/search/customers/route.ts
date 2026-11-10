import { defineRoute } from "@/core/http/define-route";
import { jsonOk } from "@/lib/api/http";
import { searchCustomers } from "@/modules/customers/search";

// GET /api/v1/search/customers?q=: up to 20 customers by name or phone, with what they owe.
export const GET = defineRoute({
  permission: "customers.view",
  handler: async ({ request, session }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 100);
    return jsonOk(await searchCustomers({ organizationId: session.organizationId, q }));
  },
});
