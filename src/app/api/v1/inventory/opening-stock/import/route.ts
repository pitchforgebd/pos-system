import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { RuleError } from "@/core/errors/rule-error";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { confirmOpeningImport } from "@/modules/imports/opening-import";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";

const bodySchema = z.object({
  fileName: z.string().trim().max(255).optional(),
  csv: z.string(),
  businessDate: z.string(),
  warehouseId: z.string().uuid().optional(),
});

export const POST = defineRoute({
  permission: "inventory.opening",
  transaction: false,
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
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
        businessDate: parsed.data.businessDate,
        ip: clientIp(request),
        userAgent: actor.userAgent,
      });
      if (!result.ok) {
        return jsonError("BUSINESS_RULE", result.message, result.status);
      }
      return jsonOk(result, "Operation completed", result.replayed ? 200 : 201);
    } catch (error) {
      if (error instanceof RuleError) {
        return jsonError(error.status === 409 ? "CONFLICT" : "BUSINESS_RULE", error.message, error.status);
      }
      throw error;
    }
  },
});
