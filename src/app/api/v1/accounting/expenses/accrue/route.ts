import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { accrueMonth } from "@/modules/treasury/expenses";

const bodySchema = z.object({ periodMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

// POST /api/v1/accounting/expenses/accrue: month end, what is still unpaid is booked as owed (#30). The owner's one click.
export const POST = defineRoute({
  permission: "expenses.accrue",
  body: bodySchema,
  idempotent: true,
  handler: async ({ request, session, body, idempotencyKey }) => {
    const actor = stockActor(session, request);
    if (!actor || !idempotencyKey) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = await accrueMonth({ ...actor, idempotencyKey, ...body });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ count: result.count, total: result.total, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
