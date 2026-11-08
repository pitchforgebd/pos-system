import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";

import { clientIp, jsonError } from "@/lib/api/http";
import { requirePermission } from "@/modules/access/guard";
import { readProductImage, saveProductImage } from "@/modules/catalog/images";

export const GET = defineRoute<undefined, { id: string }>({
  handler: async ({ session, params }) => {
    const canSee =
      session.permissions.has("products.view") ||
      session.permissions.has("sales.view") ||
      session.permissions.has("sales.create");
    if (!canSee) {
      return requirePermission(session, "products.view") ?? jsonError("AUTHORIZATION_ERROR", "You do not have permission for this action.", 403);
    }
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A product is required.", 400);
    }
    const image = await readProductImage(session.organizationId, id);
    if (!image) {
      return jsonError("NOT_FOUND", "That product has no photo.", 404);
    }
    return new Response(new Uint8Array(image.bytes), {
      headers: { "content-type": image.mimeType, "cache-control": "private, max-age=60" },
    });
  },
});

export const POST = defineRoute<undefined, { id: string }>({
  handler: async ({ request, session, params }) => {
    if (!session.permissions.has("products.edit") && !session.permissions.has("products.create")) {
      return requirePermission(session, "products.edit") ?? jsonError("AUTHORIZATION_ERROR", "You do not have permission for this action.", 403);
    }
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError("VALIDATION_ERROR", "A product is required.", 400);
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return jsonError("VALIDATION_ERROR", "Choose a product photo.", 400);
    }
    const result = await saveProductImage({
      organizationId: session.organizationId,
      productId: id,
      userId: session.userId,
      bytes: Buffer.from(await file.arrayBuffer()),
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!result.ok) {
      return jsonError(result.status === 404 ? "NOT_FOUND" : "BUSINESS_RULE", result.message, result.status);
    }
    return Response.json({ success: true, data: { saved: true }, message: "Operation completed", meta: {} }, { status: 201 });
  },
});
