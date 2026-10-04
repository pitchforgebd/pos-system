import { z } from "zod";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { createCategory, listCategories } from "@/modules/catalog/references";

const bodySchema = z.object({ name: z.string().trim().min(1).max(191) });

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "products.view");
  if (denied) {
    return denied;
  }
  return jsonOk(await listCategories(auth.session.organizationId));
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
  const denied = requirePermission(auth.session, "products.create");
  if (denied) {
    return denied;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("VALIDATION_ERROR", "Validation failed", 400);
  }
  const result = await createCategory({ organizationId: auth.session.organizationId, name: parsed.data.name });
  if (!result.ok) {
    return jsonError("CONFLICT", result.message, result.status);
  }
  return jsonOk(result.row, "Operation completed", 201);
}
