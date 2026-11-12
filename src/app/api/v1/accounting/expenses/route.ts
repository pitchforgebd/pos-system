import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { listExpenseRows, payExpense } from "@/modules/treasury/expenses";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const bodySchema = z.object({
  businessDate: isoDate,
  categoryId: z.string().uuid(),
  moneyAccountId: z.string().uuid(),
  amount: z.string().max(24),
  charge: z.string().max(24).optional(),
  /** The month the expense belongs to (YYYY-MM); the month of the date when left out. */
  periodMonth: month.optional(),
  note: z.string().trim().max(255).optional(),
});

// GET /api/v1/accounting/expenses?periodMonth=&status=: the expenses of the branch, drafts and owed ones included.
export const GET = defineRoute({
  permission: "accounting.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing expenses.", 422);
    }
    const url = new URL(request.url);
    const period = month.safeParse(url.searchParams.get("periodMonth") ?? undefined);
    const status = z.enum(["DRAFT", "PAID", "ACCRUED"]).safeParse(url.searchParams.get("status") ?? undefined);
    return jsonOk(await listExpenseRows(actor.organizationId, actor.branchId, { periodMonth: period.success ? period.data : undefined, status: status.success ? status.data : undefined }));
  },
});

// POST /api/v1/accounting/expenses: an expense paid now from a cash, bank or mobile account (with the service's charge, if any).
export const POST = defineRoute({
  permission: "accounting.post",
  body: bodySchema,
  idempotent: true,
  handler: async ({ request, session, body, idempotencyKey }) => {
    const actor = stockActor(session, request);
    if (!actor || !idempotencyKey) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = await payExpense({ ...actor, idempotencyKey, ...body });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
