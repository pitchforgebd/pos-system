import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { jsonError, jsonOk } from "@/lib/api/http";
import { createCrmSegment, listCrmSegments } from "@/modules/customers/crm";

const bodySchema = z.object({ name: z.string().trim().min(1).max(191) });

export const GET = defineRoute({
  permission: "crm.manage",
  handler: async ({ session }) => {
    return jsonOk(await listCrmSegments(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "crm.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createCrmSegment({ organizationId: session.organizationId, name: parsed.data.name });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result.segment, "Operation completed", 201);
  },
});
