import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { settleAccrued } from "@/modules/treasury/expenses";

const bodySchema = z.object({ businessDate: isoDate, moneyAccountId: z.string().uuid(), charge: z.string().max(24).optional() });

// POST /api/v1/accounting/expenses/:id/settle: pay an expense that was booked as owed (Dr Accrued Expenses / Cr the account the money leaves).
export const POST = defineRoute<z.infer<typeof bodySchema>, { id: string }>({
  permission: "accounting.post",
  body: bodySchema,
  idempotent: true,
  handler: async ({ request, session, params, body, idempotencyKey }) => {
    const actor = stockActor(session, request);
    const { id } = await params;
    if (!actor || !idempotencyKey || !z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key and an expense are required.", 400);
    }
    const result = await settleAccrued({ ...actor, idempotencyKey, expenseId: id, ...body });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
