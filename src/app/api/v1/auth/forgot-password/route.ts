import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requestPasswordReset } from "@/modules/auth/password-reset";

const bodySchema = z.object({
  email: z.string().trim().email(),
});

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400, { email: "Enter a valid email." });
  }
  const result = await requestPasswordReset({
    email: parsed.data.email,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", 429);
  }
  return jsonOk({ accepted: true }, "If that email belongs to an active account, reset instructions were issued.");
}
