import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { RuleError } from "@/core/errors/rule-error";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { confirmProductImport, latestProductImport } from "@/modules/imports/product-import";
import { idempotencyKey } from "@/modules/inventory/actor";

const bodySchema = z.object({
  fileName: z.string().trim().max(255).optional(),
  csv: z.string(),
});

export const GET = defineRoute({
  permission: "products.import",
  handler: async ({ session }) => {
    return jsonOk(await latestProductImport(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "products.import",
  transaction: false,
  handler: async ({ request, session }) => {
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "An Idempotency-Key and a CSV are required.", 400);
    }
    try {
      const result = await confirmProductImport({
        organizationId: session.organizationId,
        userId: session.userId,
        idempotencyKey: key,
        fileName: parsed.data.fileName ?? "products.csv",
        csv: parsed.data.csv,
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent"),
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
