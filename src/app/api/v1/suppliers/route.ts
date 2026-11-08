import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createSupplier, listSuppliers } from "@/modules/purchasing/suppliers";

const createSchema = z.object({
  name: z.string().trim().min(1).max(191),
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  openingPayable: z.string().default("0.00"),
  creditLimit: z.string().nullable().optional(),
  paymentTerms: z.string().trim().max(64).nullable().optional(),
});

export const GET = defineRoute({
  permission: "suppliers.view",
  handler: async ({ session }) => {
    return jsonOk(await listSuppliers(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "suppliers.create",
  handler: async ({ request, session }) => {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createSupplier({
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
    return jsonOk(result.supplier, "Operation completed", 201);
  },
});
