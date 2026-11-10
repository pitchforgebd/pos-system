import { z } from "zod";

import { defineRoute } from "@/core/http/define-route";
import { jsonError, jsonOk } from "@/lib/api/http";
import { postOpeningCash } from "@/modules/accounting/books";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";

const bodySchema = z.object({ amount: z.string() });

// The cash in the drawer when the books start, entered once per branch (Dr Cash in Hand / Cr Opening Balance Equity).
export const POST = defineRoute({
  permission: "accounting.post",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and an opening cash amount are required.", 400);
    }
    const result = await postOpeningCash({ ...actor, idempotencyKey: key, amount: parsed.data.amount });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
