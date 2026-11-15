import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { listYears, closeYear } from "@/modules/accounting/year-end";
import { stockActor } from "@/modules/inventory/actor";

// GET /api/v1/accounting/year-end: the fiscal years with their state and profit.
export const GET = defineRoute({
  permission: "accounting.view",
  handler: async ({ session }) => jsonOk(await listYears(session.organizationId)),
});

// POST /api/v1/accounting/year-end: close a finished fiscal year (period.close): the closing journal, the profit to Retained Earnings, the period locked.
export const POST = defineRoute({
  permission: "period.close",
  body: z.object({ startYear: z.number().int().min(2000).max(2100), confirm: z.string().trim().min(1).max(16) }),
  idempotent: true,
  handler: async ({ request, session, body, idempotencyKey }) => {
    const actor = stockActor(session, request);
    if (!actor || !idempotencyKey) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = await closeYear({ ...actor, idempotencyKey, ...body });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, profit: result.profit, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
