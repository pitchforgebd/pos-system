import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { postReceiptlessReturn } from "@/modules/sales/receiptless";

const body = z.object({
  businessDate: isoDate,
  customerId: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(255),
  refundMethod: z.enum(["CASH", "BANK", "MOBILE"]),
  refundAccountId: z.string().uuid().optional(),
  /** The second user's login and password, typed at the counter. */
  approver: z.object({ email: z.string().trim().email().max(191), password: z.string().min(1).max(200) }),
  lines: z.array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid().optional(), quantity: z.string().max(24), unitRefund: z.string().max(24).optional() })).min(1).max(50),
});

// POST /api/v1/returns/without-invoice: goods coming back with no invoice (needs returns.without_invoice and a second user's approval).
export const POST = defineRoute({
  permission: "returns.without_invoice",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, a reason, an approver and at least one line are required.", 400);
    }
    const result = await postReceiptlessReturn({ ...actor, idempotencyKey: key, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, total: result.total, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
