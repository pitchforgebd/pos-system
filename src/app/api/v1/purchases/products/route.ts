import { defineRoute } from "@/core/http/define-route";

import { jsonOk } from "@/lib/api/http";
import { searchPurchasable } from "@/modules/purchasing/lookups";

// GET /api/v1/purchases/products?q=: up to 20 products that can be bought, with what each cost last time.
export const GET = defineRoute({
  permission: "purchase.create",
  handler: async ({ request, session }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 100);
    return jsonOk(await searchPurchasable(session.organizationId, q));
  },
});
