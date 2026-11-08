import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { resetPassword } from "@/modules/auth/password-reset";

const bodySchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).max(128),
});

export const POST = defineRoute({
  public: true,
  transaction: false,
  handler: async ({ request }) => {
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
  },
});
