import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { resetPassword } from "@/modules/auth/password-reset";

const bodySchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await resetPassword({
    token: parsed.data.token,
    password: parsed.data.password,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError("VALIDATION_ERROR", result.message, 400);
  }
  return jsonOk({ reset: true }, "Password was changed.");
}
