import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { idempotencyKey } from "@/modules/inventory/actor";
import { postTransfer } from "@/modules/inventory/documents";

const bodySchema = z.object({
  fromBranchId: z.string().uuid(),
  toBranchId: z.string().uuid(),
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  lines: z.array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid().optional(), quantity: z.string() })).min(1).max(100),
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
  const denied = requirePermission(auth.session, "inventory.transfer");
  if (denied) {
    return denied;
  }
  const key = idempotencyKey(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!key || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "An Idempotency-Key and a transfer are required.", 400);
  }
  // Stock may only be sent out of a branch the user works in.
  if (!auth.session.branchIds.has(parsed.data.fromBranchId)) {
    return jsonError("AUTHORIZATION_ERROR", "You can only transfer stock out of your own branches.", 403);
  }
  const result = await postTransfer({
    organizationId: auth.session.organizationId,
    userId: auth.session.userId,
    ...parsed.data,
    idempotencyKey: key,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Transfer received", result.replayed ? 200 : 201);
}
