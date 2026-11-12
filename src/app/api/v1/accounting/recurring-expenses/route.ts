import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { listRecurring, saveRecurring } from "@/modules/treasury/expenses";

const bodySchema = z.object({
  id: z.string().uuid().optional(),
  categoryId: z.string().uuid(),
  amount: z.string().max(24),
  dayOfMonth: z.number().int().min(1).max(31),
  note: z.string().trim().max(255).optional(),
  active: z.boolean().optional(),
});

// GET /api/v1/accounting/recurring-expenses: the fixed expenses that come every month (rent, salary).
export const GET = defineRoute({
  permission: "accounting.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch first.", 422);
    }
    return jsonOk(await listRecurring(actor.organizationId, actor.branchId));
  },
});

// POST /api/v1/accounting/recurring-expenses: add a recurring expense or change one; each month a draft is made for it.
export const POST = defineRoute({
  permission: "accounting.post",
  body: bodySchema,
  handler: async ({ request, session, body }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch first.", 422);
    }
    const result = await saveRecurring(actor, body);
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", body.id ? 200 : 201);
  },
});
