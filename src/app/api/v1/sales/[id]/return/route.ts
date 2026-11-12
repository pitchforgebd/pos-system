import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { postSaleReturn } from "@/modules/sales/returns";

const bodySchema = z.object({
  businessDate: isoDate,
  /** Where the money goes: the way the customer paid when left out. */
  refundMethod: z.enum(["CASH", "BANK", "MOBILE", "ADVANCE", "AR_ONLY"]).optional(),
  refundAccountId: z.string().uuid().optional(),
  lines: z.array(z.object({ saleItemId: z.string().uuid(), quantity: z.string() })).min(1).max(100),
});

export const POST = defineRoute<undefined, { id: string }>({
  permission: "sales.return",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and at least one line are required.", 400);
    }
    const { id } = await params;
    const result = await postSaleReturn({ ...actor, idempotencyKey: key, saleId: id, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, total: result.total, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
