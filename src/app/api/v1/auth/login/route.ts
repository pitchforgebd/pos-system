import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { applySessionCookie } from "@/modules/auth/cookie";
import { login } from "@/modules/auth/login";

const bodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
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
}
