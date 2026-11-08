import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { previewProductCsv } from "@/modules/imports/product-import";

const bodySchema = z.object({ csv: z.string() });

export const POST = defineRoute({
  permission: "products.import",
  transaction: false,
  handler: async ({ request }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "A CSV is required.", 400);
    }
    const result = previewProductCsv(parsed.data.csv);
    if (!result.ok) {
      return jsonError("BUSINESS_RULE", result.message, result.status);
    }
    return jsonOk(result.rows);
  },
});
