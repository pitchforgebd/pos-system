import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { reverseJournal } from "@/modules/accounting/books";

const bodySchema = z.object({ businessDate: isoDate });

export const POST = defineRoute<undefined, { id: string }>({
  permission: "accounting.reverse",
  handler: async ({ request, session, params }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a date are required.", 400);
    }
    const { id } = await params;
    const result = await reverseJournal({ ...actor, idempotencyKey: key, journalId: id, businessDate: parsed.data.businessDate });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
