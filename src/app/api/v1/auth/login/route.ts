import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { applySessionCookie } from "@/modules/auth/cookie";
import { login } from "@/modules/auth/login";

const bodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

export const POST = defineRoute({
  public: true,
  transaction: false,
  handler: async ({ request }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400, { email: "Enter a valid email and password." });
    }
    const result = await login({
      email: parsed.data.email,
      password: parsed.data.password,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      const code = result.status === 429 ? "RATE_LIMITED" : "AUTHENTICATION_ERROR";
      return jsonError(code, result.message, result.status);
    }
    return applySessionCookie(jsonOk({ signedIn: true }), result.token);
  },
});
