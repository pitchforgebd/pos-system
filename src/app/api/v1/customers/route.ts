import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { createCustomer, listCustomers } from "@/modules/customers/customers";

const createSchema = z.object({
  name: z.string().trim().min(1).max(191),
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  customerTypeId: z.string().uuid().nullable().optional(),
  openingBalance: z.string().optional(),
  creditLimit: z.string().nullable().optional(),
  paymentTerms: z.string().trim().max(64).nullable().optional(),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "customers.view");
  if (denied) {
    return denied;
  }
  return jsonOk(await listCustomers(auth.session.organizationId));
}

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "customers.create");
  if (denied) {
    return denied;
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await createCustomer({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    branchId: auth.session.branchId,
    ...parsed.data,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk(result.customer, "Operation completed", 201);
}
