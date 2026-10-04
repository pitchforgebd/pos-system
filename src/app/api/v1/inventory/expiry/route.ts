import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { stockActor } from "@/modules/inventory/actor";
import { listExpiry, writeOffExpiry } from "@/modules/inventory/documents";

const bodySchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.string(),
  warehouseId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "inventory.view");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  if (!actor) {
    return jsonError("BUSINESS_RULE", "Select a branch before viewing stock.", 422);
  }
  const params = new URL(request.url).searchParams;
  return jsonOk(
    await listExpiry({
      organizationId: actor.organizationId,
      branchId: actor.branchId,
      productId: params.get("productId")?.trim() || undefined,
      barcode: params.get("barcode")?.trim() || undefined,
      brandId: params.get("brandId")?.trim() || undefined,
      categoryId: params.get("categoryId")?.trim() || undefined,
      generic: params.get("generic")?.trim() || undefined,
      lot: params.get("lot")?.trim() || undefined,
    }),
  );
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
  const denied = requirePermission(auth.session, "inventory.expiry");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!actor || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await writeOffExpiry({ ...actor, idempotencyKey: "", ...parsed.data });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id, quantity: result.quantity });
}
