import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { addCourier } from "@/modules/reference/extras";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(191),
  phone: z.string().trim().max(32).optional(),
});

export async function POST(request: Request) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "settings.manage");
  if (denied) {
    return denied;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "A courier name is required.", 400);
  }
  const result = await addCourier({ organizationId: auth.session.organizationId, ...parsed.data });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk({ id: result.id }, "Operation completed", 201);
}
