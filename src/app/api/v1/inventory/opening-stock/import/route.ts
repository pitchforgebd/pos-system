import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { confirmOpeningImport } from "@/modules/imports/opening-import";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { StockRuleError } from "@/modules/inventory/stock";

const bodySchema = z.object({
  fileName: z.string().trim().max(255).optional(),
  csv: z.string(),
  occurredOn: z.string(),
  warehouseId: z.string().uuid().optional(),
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
  const denied = requirePermission(auth.session, "inventory.opening");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const key = idempotencyKey(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!actor || !key || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and a CSV are required.", 400);
  }
  try {
    const result = await confirmOpeningImport({
      organizationId: actor.organizationId,
      branchId: actor.branchId,
      userId: actor.userId,
      warehouseId: parsed.data.warehouseId,
      idempotencyKey: key,
      fileName: parsed.data.fileName ?? "opening-stock.csv",
      csv: parsed.data.csv,
      occurredOn: parsed.data.occurredOn,
      ip: clientIp(request),
      userAgent: actor.userAgent,
    });
    if (!result.ok) {
      return jsonError("BUSINESS_RULE", result.message, result.status);
    }
    return jsonOk(result, "Operation completed", result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof StockRuleError) {
      return jsonError(error.status === 409 ? "CONFLICT" : "BUSINESS_RULE", error.message, error.status);
    }
    throw error;
  }
}
