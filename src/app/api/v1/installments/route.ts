import { z } from "zod";
import { isoDate } from "@/core/time/iso-date";

import { clientIp, jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { createInstallment, listInstallments } from "@/modules/customers/installments";

const bodySchema = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: z.string(),
  dueOn: isoDate,
  interestPercent: z.string().optional(),
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
  return jsonOk(await listInstallments(auth.session.organizationId));
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
  const denied = requirePermission(auth.session, "customers.edit");
  if (denied) {
    return denied;
  }
  if (!auth.session.branchId) {
    return jsonError("VALIDATION_ERROR", "A branch is required.", 400);
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await createInstallment({
    organizationId: auth.session.organizationId,
    branchId: auth.session.branchId,
    actorId: auth.session.userId,
    ...parsed.data,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk(result.installment, "Operation completed", 201);
}
