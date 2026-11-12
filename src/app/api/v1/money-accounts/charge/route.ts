import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { suggestCharge } from "@/modules/treasury/charges";

// GET /api/v1/money-accounts/charge?accountId=&amount=: the charge the bank or mobile service takes on that amount (the forms propose it; the user may
// change it). Every signed-in user: a cashier needs it at the register.
export const GET = defineRoute({
  handler: async ({ request, session }) => {
    const url = new URL(request.url);
    const accountId = z.string().uuid().safeParse(url.searchParams.get("accountId"));
    const amount = z.string().max(24).safeParse(url.searchParams.get("amount"));
    if (!accountId.success || !amount.success) {
      return jsonError("VALIDATION_ERROR", "An account and an amount are required.", 400);
    }
    return jsonOk(await suggestCharge(session.organizationId, accountId.data, amount.data));
  },
});
