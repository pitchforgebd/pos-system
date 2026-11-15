import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createCustomer, listCustomers } from "@/modules/customers/customers";

const createSchema = z.object({
  name: z.string().trim().min(1).max(191),
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  customerTypeId: z.string().uuid().nullable().optional(),
  openingBalance: z.string().trim().max(32).optional(),
  creditLimit: z.string().trim().max(32).nullable().optional(),
  paymentTerms: z.string().trim().max(64).nullable().optional(),
  businessName: z.string().trim().max(191).nullable().optional(),
  altPhone: z.string().trim().max(32).nullable().optional(),
  nid: z.string().trim().max(32).nullable().optional(),
  /** The district is required (D15); the upazila is optional. */
  districtId: z.number().int().positive(),
  upazilaId: z.number().int().positive().nullable().optional(),
  tags: z.string().trim().max(255).nullable().optional(),
  smsOptOut: z.boolean().optional(),
  paymentDays: z.number().int().min(0).max(365).nullable().optional(),
});

export const GET = defineRoute({
  permission: "customers.view",
  handler: async ({ session }) => {
    return jsonOk(await listCustomers(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "customers.create",
  handler: async ({ request, session }) => {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", parsed.error.issues.some((issue) => issue.path[0] === "districtId") ? "Choose the district." : "Validation failed", 400);
    }
    const result = await createCustomer({
      organizationId: session.organizationId,
      actorId: session.userId,
      branchId: session.branchId,
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk({ ...result.customer, samePhone: result.samePhone }, "Operation completed", 201);
  },
});
