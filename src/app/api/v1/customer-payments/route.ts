import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { listCustomerPayments, postCustomerPayment } from "@/modules/customers/dues";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";

const bodySchema = z.object({
  customerId: z.string().uuid(),
  businessDate: isoDate,
  amount: z.string(),
  method: z.enum(["CASH", "BANK", "MOBILE"]),
  accountId: z.string().uuid().optional(),
  charge: z.string().max(24).optional(),
  /** The invoices this receipt is for; the rest settles the oldest debt. */
  allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount: z.string() })).max(100).optional(),
});

export const GET = defineRoute({
  permission: "customers.view",
  handler: async ({ session }) => {
    if (!session.branchId) {
      return jsonError("VALIDATION_ERROR", "A branch is required.", 400);
    }
    return jsonOk(await listCustomerPayments(session.organizationId, session.branchId));
  },
});

export const POST = defineRoute({
  permission: "customers.payment",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a payment are required.", 400);
    }
    const result = await postCustomerPayment({ ...actor, idempotencyKey: key, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Operation completed", result.replayed ? 200 : 201);
  },
});
