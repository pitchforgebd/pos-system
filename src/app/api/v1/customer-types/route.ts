import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createCustomerType, listCustomerTypes } from "@/modules/customers/customers";

const createSchema = z.object({ name: z.string().trim().min(1).max(191) });

export const GET = defineRoute({
  permission: "customers.view",
  handler: async ({ session }) => {
    return jsonOk(await listCustomerTypes(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "customers.create",
  handler: async ({ request, session }) => {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createCustomerType({
      organizationId: session.organizationId,
      actorId: session.userId,
      name: parsed.data.name,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result.type, "Operation completed", 201);
  },
});
