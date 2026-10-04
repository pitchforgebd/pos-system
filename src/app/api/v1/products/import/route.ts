import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { confirmProductImport, latestProductImport } from "@/modules/imports/product-import";
import { idempotencyKey } from "@/modules/inventory/actor";
import { StockRuleError } from "@/modules/inventory/stock";

const bodySchema = z.object({
  fileName: z.string().trim().max(255).optional(),
  csv: z.string(),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "products.import");
  if (denied) {
    return denied;
  }
  return jsonOk(await latestProductImport(auth.session.organizationId));
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
  const denied = requirePermission(auth.session, "products.import");
  if (denied) {
    return denied;
  }
  const key = idempotencyKey(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!key || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "An Idempotency-Key and a CSV are required.", 400);
  }
  try {
    const result = await confirmProductImport({
      organizationId: auth.session.organizationId,
      userId: auth.session.userId,
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
    if (error instanceof StockRuleError) {
      return jsonError(error.status === 409 ? "CONFLICT" : "BUSINESS_RULE", error.message, error.status);
    }
    throw error;
  }
}
