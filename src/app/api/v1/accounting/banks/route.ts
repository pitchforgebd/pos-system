import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { createBankAccount } from "@/modules/accounting/books";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(191),
  openingAmount: z.string().optional(),
});

export const POST = defineRoute({
  permission: "accounting.post",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a bank name are required.", 400);
    }
    const result = await createBankAccount({ ...actor, idempotencyKey: key, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, code: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
