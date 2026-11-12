import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { expenseReport } from "@/modules/treasury/expenses";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// GET /api/v1/accounting/expenses/report?from=YYYY-MM&to=YYYY-MM: what each month cost, by category (by the month an expense belongs to).
export const GET = defineRoute({
  permission: "accounting.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const url = new URL(request.url);
    const from = month.safeParse(url.searchParams.get("from"));
    const to = month.safeParse(url.searchParams.get("to"));
    if (!actor || !from.success || !to.success) {
      return jsonError("VALIDATION_ERROR", "A branch and the months (YYYY-MM) are required.", 400);
    }
    return jsonOk(await expenseReport(actor.organizationId, actor.branchId, from.data, to.data));
  },
});
