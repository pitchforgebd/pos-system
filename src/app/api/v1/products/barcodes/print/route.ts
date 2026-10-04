import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { recordBarcodePrint } from "@/modules/catalog/barcodes";

const bodySchema = z.object({
  barcodeId: z.string().uuid(),
  copies: z.number().int(),
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
  const denied = requirePermission(auth.session, "products.view");
  if (denied) {
    return denied;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await recordBarcodePrint({
    organizationId: auth.session.organizationId,
    userId: auth.session.userId,
    barcodeId: parsed.data.barcodeId,
    copies: parsed.data.copies,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE", result.message, result.status);
  }
  return jsonOk(result);
}
