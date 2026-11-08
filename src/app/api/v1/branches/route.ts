import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createBranch, listCompanyBranches } from "@/modules/access/branches";

const bodySchema = z.object({
  name: z.string(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

export const GET = defineRoute({
  permission: "branches.manage",
  handler: async ({ session }) => {
    return jsonOk(await listCompanyBranches(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "branches.manage",
  handler: async ({ request, session }) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createBranch({
      organizationId: session.organizationId,
      actorId: session.userId,
      name: parsed.data.name,
      phone: parsed.data.phone,
      address: parsed.data.address,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      const code = result.status === 409 ? "CONFLICT" : "BUSINESS_RULE";
      return jsonError(code, result.message, result.status);
    }
    return jsonOk({ id: result.branch.id }, "Branch created", 201);
  },
});
