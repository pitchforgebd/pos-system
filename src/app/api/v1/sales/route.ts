import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { requirePermission } from "@/modules/access/guard";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { listQuery } from "@/core/list";
import { listSales, postSale, saleSorts } from "@/modules/sales/sales";

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

export const GET = defineRoute({
  permission: "sales.view",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    if (!actor) {
      return jsonError("BUSINESS_RULE", "Select a branch before viewing sales.", 422);
    }
    const params = new URL(request.url).searchParams;
    const query = listQuery({ page: params.get("page"), pageSize: params.get("pageSize"), sort: params.get("sort") }, { sorts: saleSorts });
    const { rows, page } = await listSales(actor.organizationId, actor.branchId, query);
    return jsonOk(rows, "Operation completed", 200, { page });
  },
});

export const POST = defineRoute({
  permission: "sales.create",
  handler: async ({ request, session }) => {
    const actor = stockActor(session, request);
    const key = idempotencyKey(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!actor || !key || !parsed.success) {
      return jsonError("VALIDATION_ERROR", "A branch, an Idempotency-Key, and at least one line are required.", 400);
    }
    if (parsed.data.lines.some((line) => line.discountAmount && line.discountAmount !== "0" && line.discountAmount !== "0.00")) {
      const discountDenied = requirePermission(session, "sales.discount");
      if (discountDenied) {
        return discountDenied;
      }
    }
    const result = await postSale({
      ...actor,
      idempotencyKey: key,
      warehouseId: parsed.data.warehouseId,
      allowPriceOverride: session.permissions.has("sales.price_override"),
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
  },
});
