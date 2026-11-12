import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { postContraTransfer } from "@/modules/treasury/contra";
import { listTransfers } from "@/modules/treasury/dashboard";

const bodySchema = z.object({
  businessDate: isoDate,
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.string().max(24),
  charge: z.string().max(24).optional(),
  note: z.string().trim().max(255).optional(),
});

// GET /api/v1/accounting/transfers: the latest transfers between the shop's own accounts.
export const GET = defineRoute({
  permission: "accounting.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch first.", 422);
    }
    return jsonOk(await listTransfers(actor.organizationId, actor.branchId));
  },
});

// POST /api/v1/accounting/transfers: move money between any two cash, bank or mobile accounts (#31), with the sender's charge.
export const POST = defineRoute({
  permission: "accounting.post",
  body: bodySchema,
  idempotent: true,
  handler: async ({ request, session, body, idempotencyKey }) => {
    const actor = stockActor(session, request);
    if (!actor || !idempotencyKey) {
      return jsonError("VALIDATION_ERROR", "A branch and an Idempotency-Key are required.", 400);
    }
    const result = await postContraTransfer({ ...actor, idempotencyKey, ...body });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
