import { z } from "zod";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { listCustomerAdvances, postCustomerAdvance } from "@/modules/customers/advances";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";

const bodySchema = z.object({
  customerId: z.string().uuid(),
  businessDate: isoDate,
  amount: z.string(),
  method: z.enum(["CASH", "BANK"]),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "customers.view");
  if (denied) {
    return denied;
  }
  if (!auth.session.branchId) {
    return jsonError("VALIDATION_ERROR", "A branch is required.", 400);
  }
  return jsonOk(await listCustomerAdvances(auth.session.organizationId, auth.session.branchId));
}

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "customers.advance");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
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
}
