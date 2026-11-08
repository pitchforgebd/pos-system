import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { getCustomer, updateCustomer } from "@/modules/customers/customers";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(191),
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  customerTypeId: z.string().uuid().nullable().optional(),
  creditLimit: z.string().nullable().optional(),
  paymentTerms: z.string().trim().max(64).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export const GET = defineRoute<undefined, { id: string }>({
  permission: "customers.view",
  handler: async ({ session, params }) => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    const customer = await getCustomer(session.organizationId, id);
    if (!customer) {
      return jsonError("NOT_FOUND", "That record was not found.", 404);
    }
    return jsonOk(customer);
  },
});

export const PATCH = defineRoute<undefined, { id: string }>({
  permission: "customers.edit",
  handler: async ({ request, session, params }) => {
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await updateCustomer({
      organizationId: session.organizationId,
      actorId: session.userId,
      customerId: id,
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result.customer);
  },
});
