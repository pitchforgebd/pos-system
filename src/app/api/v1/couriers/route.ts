import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { addCourier } from "@/modules/reference/extras";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(191),
  phone: z.string().trim().max(32).optional(),
});

export const POST = defineRoute({
  permission: "settings.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "A courier name is required.", 400);
    }
    const result = await addCourier({ organizationId: session.organizationId, ...parsed.data });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ id: result.id }, "Operation completed", 201);
  },
});
