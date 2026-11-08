import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { listCustomerAdvances, postCustomerAdvance } from "@/modules/customers/advances";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";

const bodySchema = z.object({
  customerId: z.string().uuid(),
  businessDate: isoDate,
  amount: z.string(),
  method: z.enum(["CASH", "BANK"]),
});

export const GET = defineRoute({
  permission: "customers.view",
  handler: async ({ session }) => {
    if (!session.branchId) {
      return jsonError("VALIDATION_ERROR", "A branch is required.", 400);
    }
    return jsonOk(await listCustomerAdvances(session.organizationId, session.branchId));
  },
});

export const POST = defineRoute({
  permission: "customers.advance",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and an advance are required.", 400);
    }
    const result = await postCustomerAdvance({ ...actor, idempotencyKey: key, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
