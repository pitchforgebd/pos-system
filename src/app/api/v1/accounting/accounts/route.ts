import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { createAccount, listAccounts } from "@/modules/accounting/books";

const bodySchema = z.object({
  code: z.string().trim().min(2).max(16),
  name: z.string().trim().min(1).max(191),
  groupCode: z.string().trim().min(1).max(16),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "accounting.view");
  if (denied) {
    return denied;
  }
  return jsonOk(await listAccounts(auth.session.organizationId));
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
  const denied = requirePermission(auth.session, "accounting.create");
  if (denied) {
    return denied;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await createAccount({ organizationId: auth.session.organizationId, ...parsed.data });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk(result.account, "Operation completed", 201);
}
