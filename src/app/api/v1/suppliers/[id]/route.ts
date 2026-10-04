import { z } from "zod";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { getSupplier, updateSupplier } from "@/modules/purchasing/suppliers";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(191),
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  creditLimit: z.string().nullable().optional(),
  paymentTerms: z.string().trim().max(64).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "suppliers.view");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  const supplier = await getSupplier(auth.session.organizationId, id);
  if (!supplier) {
    return jsonError("NOT_FOUND", "That record was not found.", 404);
  }
  return jsonOk(supplier);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "suppliers.edit");
  if (denied) {
    return denied;
  }
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await updateSupplier({
    organizationId: auth.session.organizationId,
    actorId: auth.session.userId,
    supplierId: id,
    ...parsed.data,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk(result.supplier);
}
