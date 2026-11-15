import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonOk } from "@/lib/api/http";
import { normalizeBdPhone, samePhone } from "@/modules/parties/profile";

// GET /api/v1/customers/same-phone?phone=&except=: who else already has this number (the form warns; it does not refuse).
export const GET = defineRoute({
  permission: "customers.view",
  handler: async ({ request, session }) => {
    const url = new URL(request.url);
    const phone = normalizeBdPhone(url.searchParams.get("phone"));
    const except = z.string().uuid().safeParse(url.searchParams.get("except"));
    const rows = await samePhone(session.organizationId, "CUSTOMER", phone, except.success ? except.data : undefined);
    return jsonOk(rows.map((row) => ({ code: row.code, name: row.name })));
  },
});
