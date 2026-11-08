import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { createUnit, listUnits } from "@/modules/catalog/references";

const bodySchema = z.object({ name: z.string().trim().min(1).max(191) });

export const GET = defineRoute({
  permission: "products.view",
  handler: async ({ session }) => {
    return jsonOk(await listUnits(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "products.create",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createUnit({ organizationId: session.organizationId, name: parsed.data.name });
    if (!result.ok) {
      return jsonError("CONFLICT", result.message, result.status);
    }
    return jsonOk(result.row, "Operation completed", 201);
  },
});
