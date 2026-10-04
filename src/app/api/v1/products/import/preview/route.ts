import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { previewProductCsv } from "@/modules/imports/product-import";

const bodySchema = z.object({ csv: z.string() });

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
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "A CSV is required.", 400);
  }
  const result = previewProductCsv(parsed.data.csv);
  if (!result.ok) {
    return jsonError("BUSINESS_RULE", result.message, result.status);
  }
  return jsonOk(result.rows);
}
