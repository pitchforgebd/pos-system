import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { requestPasswordReset } from "@/modules/auth/password-reset";

const bodySchema = z.object({
  email: z.string().trim().email(),
});

export const POST = defineRoute({
  public: true,
  transaction: false,
  handler: async ({ request }) => {
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
  },
});
