import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey } from "@/modules/inventory/actor";
import { postTransfer } from "@/modules/inventory/documents";

const bodySchema = z.object({
  fromBranchId: z.string().uuid(),
  toBranchId: z.string().uuid(),
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  lines: z.array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid().optional(), quantity: z.string() })).min(1).max(100),
});

export const POST = defineRoute({
  permission: "inventory.transfer",
  handler: async ({ request, session }) => {
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "An Idempotency-Key and a transfer are required.", 400);
    }
    // Stock may only be sent out of a branch the user works in.
    if (!session.branchIds.has(parsed.data.fromBranchId)) {
      return jsonError("AUTHORIZATION_ERROR", "You can only transfer stock out of your own branches.", 403);
    }
    const result = await postTransfer({
      organizationId: session.organizationId,
      userId: session.userId,
      ...parsed.data,
      idempotencyKey: key,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id, number: result.number, replayed: result.replayed }, "Transfer received", result.replayed ? 200 : 201);
  },
});
