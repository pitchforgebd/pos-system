import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { createBankAccount } from "@/modules/accounting/books";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(191),
  openingAmount: z.string().optional(),
});

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "accounting.post");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
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
}
