import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { DIGITS_COOKIE, LANG_COOKIE } from "@/lib/i18n/lang";

// POST /api/v1/locale: the language of the screens and/or the digits numbers are written in (D19). Each is a cookie only the server reads (L9),
// kept for a year, so the next page is made in the right language from its first byte.
const bodySchema = z
  .object({ lang: z.enum(["bn", "en"]).optional(), digits: z.enum(["bn", "en"]).optional() })
  .refine((value) => value.lang !== undefined || value.digits !== undefined, { message: "Choose a language or digits." });

export const POST = defineRoute({
  // the sign-in page has a language choice too; the answer is only a cookie, and the origin check still applies
  public: true,
  handler: async ({ request }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Choose English or Bangla.", 400);
    }
    const response = jsonOk({ lang: parsed.data.lang ?? null, digits: parsed.data.digits ?? null });
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const cookie = (name: string, value: string) => `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure}`;
    if (parsed.data.lang) {
      response.headers.append("set-cookie", cookie(LANG_COOKIE, parsed.data.lang));
    }
    if (parsed.data.digits) {
      response.headers.append("set-cookie", cookie(DIGITS_COOKIE, parsed.data.digits));
    }
    return response;
  },
});
