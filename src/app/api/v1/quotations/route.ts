import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { createQuotation, listQuotations } from "@/modules/commerce/quotations";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";

const bodySchema = z.object({
  customerId: z.string().uuid(),
  businessDate: isoDate,
  note: z.string().trim().max(255).nullable().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.string(),
        unitPrice: z.string(),
      }),
    )
    .max(50)
    .optional(),
});

export const GET = defineRoute({
  permission: "quotations.manage",
  handler: async ({ session }) => {
    if (!session.branchId) {
      return jsonError("VALIDATION_ERROR", "A branch is required.", 400);
    }
    return jsonOk(await listQuotations(session.organizationId, session.branchId));
  },
});

export const POST = defineRoute({
  permission: "quotations.manage",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a quotation are required.", 400);
    }
    const result = await createQuotation({ ...actor, idempotencyKey: key, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
