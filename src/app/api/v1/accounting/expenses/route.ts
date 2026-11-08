import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { listExpenses, postExpense } from "@/modules/accounting/books";

const bodySchema = z.object({
  businessDate: isoDate,
  accountCode: z.string().trim().min(1).max(16),
  amount: z.string(),
  method: z.enum(["CASH", "BANK"]),
  note: z.string().trim().max(255).optional(),
});

export const GET = defineRoute({
  permission: "accounting.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing expenses.", 422);
    }
    return jsonOk(await listExpenses(actor.organizationId, actor.branchId));
  },
});

export const POST = defineRoute({
  permission: "accounting.post",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and an expense amount are required.", 400);
    }
    const result = await postExpense({ ...actor, idempotencyKey: key, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
