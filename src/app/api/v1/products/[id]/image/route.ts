import { z } from "zod";

import { clientIp, jsonError, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { readProductImage, saveProductImage } from "@/modules/catalog/images";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const canSee =
    auth.session.permissions.has("products.view") ||
    auth.session.permissions.has("sales.view") ||
    auth.session.permissions.has("sales.create");
  if (!canSee) {
    return requirePermission(auth.session, "products.view") ?? jsonError("AUTHORIZATION_ERROR", "You do not have permission for this action.", 403);
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError("VALIDATION_ERROR", "A product is required.", 400);
  }
  const image = await readProductImage(auth.session.organizationId, id);
  if (!image) {
    return jsonError("NOT_FOUND", "That product has no photo.", 404);
  }
  return new Response(new Uint8Array(image.bytes), {
    headers: { "content-type": image.mimeType, "cache-control": "private, max-age=60" },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSite(request);
  if (rejected) {
    return rejected;
  }
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  if (!auth.session.permissions.has("products.edit") && !auth.session.permissions.has("products.create")) {
    return requirePermission(auth.session, "products.edit") ?? jsonError("AUTHORIZATION_ERROR", "You do not have permission for this action.", 403);
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError("VALIDATION_ERROR", "A product is required.", 400);
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return jsonError("VALIDATION_ERROR", "Choose a product photo.", 400);
  }
  const result = await saveProductImage({
    organizationId: auth.session.organizationId,
    productId: id,
    userId: auth.session.userId,
    bytes: Buffer.from(await file.arrayBuffer()),
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) {
    return jsonError(result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE", result.message, result.status);
  }
  return Response.json({ success: true, data: { saved: true }, message: "Operation completed", meta: {} }, { status: 201 });
}
