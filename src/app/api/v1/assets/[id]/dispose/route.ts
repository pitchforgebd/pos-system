import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { stockActor } from "@/modules/inventory/actor";
import { disposeAsset } from "@/modules/assets/assets";

const bodySchema = z.object({
  businessDate: isoDate,
  /** What it was sold for; nothing for a write-off. */
  amount: z.string().max(24).optional(),
  moneyAccountId: z.string().uuid().optional(),
  note: z.string().trim().max(255).optional(),
});

// POST /api/v1/assets/:id/dispose: sell or write off an asset (#38); the gain or loss goes in the books.
export const POST = defineRoute<z.infer<typeof bodySchema>, { id: string }>({
  permission: "accounting.post",
  body: bodySchema,
  idempotent: true,
  handler: async ({ request, session, params, body, idempotencyKey }) => {
    const actor = stockActor(session, request);
    const { id } = await params;
    if (!actor || !idempotencyKey || !z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key and an asset are required.", 400);
    }
    const result = await disposeAsset({ ...actor, idempotencyKey, assetId: id, ...body });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, gain: result.gain, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
