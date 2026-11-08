import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { createRequisition, listRequisitions } from "@/modules/commerce/requisitions";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";

const bodySchema = z.object({
  businessDate: isoDate,
  note: z.string().trim().min(1).max(255),
});

export const GET = defineRoute({
  permission: "requisitions.manage",
  handler: async ({ session }) => {
    if (!session.branchId) {
      return jsonError("VALIDATION_ERROR", "A branch is required.", 400);
    }
    return jsonOk(await listRequisitions(session.organizationId, session.branchId));
  },
});

export const POST = defineRoute({
  permission: "requisitions.manage",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a requisition are required.", 400);
    }
    const result = await createRequisition({ ...actor, idempotencyKey: key, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
