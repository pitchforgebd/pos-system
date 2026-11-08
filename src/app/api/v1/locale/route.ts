import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";

const bodySchema = z.object({ lang: z.enum(["bn", "en"]) });

export const POST = defineRoute({
  handler: async ({ request }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Choose English or Bangla.", 400);
    }
    const response = jsonOk({ lang: parsed.data.lang });
    response.headers.append("set-cookie", `meridian_lang=${parsed.data.lang}; Path=/; SameSite=Lax`);
    return response;
  },
});
