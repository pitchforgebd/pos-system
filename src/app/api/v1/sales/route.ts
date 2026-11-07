import { z } from "zod";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk, rejectCrossSite } from "@/lib/api/http";
import { requirePermission, requireSession } from "@/modules/access/guard";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { listSales, postSale } from "@/modules/sales/sales";

const lineSchema = z.object({
  productId: z.string().uuid().optional(),
  barcode: z.string().trim().min(1).max(64).optional(),
  variantId: z.string().uuid().optional(),
  quantity: z.string(),
  unitPrice: z.string().optional(),
  discountAmount: z.string().optional(),
  vatAmount: z.string().optional(),
  serial: z.string().trim().max(64).optional(),
});

const bodySchema = z.object({
  businessDate: isoDate,
  customerId: z.string().uuid().optional(),
  ticketId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  chargesTotal: z.string().optional(),
  paymentAmount: z.string().optional(),
  paymentMethod: z.enum(["CASH", "BANK", "CARD", "WALLET", "OTHER"]).optional(),
  lines: z.array(lineSchema).min(1).max(100),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth.response;
  }
  const denied = requirePermission(auth.session, "sales.view");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  if (!actor) {
    return jsonError("BUSINESS_RULE", "Select a branch before viewing sales.", 422);
  }
  return jsonOk(await listSales(actor.organizationId, actor.branchId));
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
  const denied = requirePermission(auth.session, "sales.create");
  if (denied) {
    return denied;
  }
  const actor = stockActor(auth.session, request);
  const key = idempotencyKey(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!actor || !key || !parsed.success) {
    return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and at least one line are required.", 400);
  }
  if (parsed.data.lines.some((line) => line.discountAmount && line.discountAmount !== "0" && line.discountAmount !== "0.00")) {
    const discountDenied = requirePermission(auth.session, "sales.discount");
    if (discountDenied) {
      return discountDenied;
    }
  }
  const result = await postSale({
    ...actor,
    idempotencyKey: key,
    warehouseId: parsed.data.warehouseId,
    allowPriceOverride: auth.session.permissions.has("sales.price_override"),
    ...parsed.data,
  });
  if (!result.ok) {
    return jsonError(result.code, result.message, result.status);
  }
  return jsonOk(
    { id: result.id, number: result.number, total: result.total, replayed: result.replayed },
    "Operation completed",
    result.replayed ? 200 : 201,
  );
}
