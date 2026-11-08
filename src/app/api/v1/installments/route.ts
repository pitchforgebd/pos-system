import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { createInstallment, listInstallments } from "@/modules/customers/installments";

const bodySchema = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: z.string(),
  dueOn: isoDate,
  interestPercent: z.string().optional(),
});

export const GET = defineRoute({
  permission: "customers.view",
  handler: async ({ session }) => {
    return jsonOk(await listInstallments(session.organizationId));
  },
});

export const POST = defineRoute({
  permission: "customers.edit",
  handler: async ({ request, session }) => {
    if (!session.branchId) {
      return jsonError("VALIDATION_ERROR", "A branch is required.", 400);
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("VALIDATION_ERROR", "Validation failed", 400);
    }
    const result = await createInstallment({
      organizationId: session.organizationId,
      branchId: session.branchId,
      actorId: session.userId,
      ...parsed.data,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(result.installment, "Operation completed", 201);
  },
});
