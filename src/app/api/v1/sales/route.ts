import { z } from "zod";
import { defineRoute } from "@/core/http/define-route";
import { isoDate } from "@/core/time/iso-date";

import { jsonError, jsonOk } from "@/lib/api/http";
import { idempotencyKey, stockActor } from "@/modules/inventory/actor";
import { listQuery } from "@/core/list";
import { listSales, postInvoice, saleSorts } from "@/modules/sales/sales";

const lineSchema = z.object({
  productId: z.string().uuid().optional(),
  barcode: z.string().trim().min(1).max(64).optional(),
  variantId: z.string().uuid().optional(),
  quantity: z.string().max(24),
  unitPrice: z.string().max(24).optional(),
  discountAmount: z.string().max(24).optional(),
  discountPercent: z.string().max(8).optional(),
  vatAmount: z.string().max(24).optional(),
  serial: z.string().trim().max(64).optional(),
});

const tenderSchema = z.object({
  method: z.enum(["CASH", "BANK", "MOBILE", "CARD", "WALLET"]),
  accountId: z.string().uuid().optional(),
  amount: z.string().max(24),
  charge: z.string().max(24).optional(),
});

const bodySchema = z.object({
  businessDate: isoDate,
  customerId: z.string().uuid().optional(),
  ticketId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  level: z.string().trim().max(64).optional(),
  headerDiscount: z.string().max(24).optional(),
  chargesTotal: z.string().max(24).optional(),
  takePreviousDue: z.boolean().optional(),
  /** Everything paid now: one entry per way of paying (cash, a bank or mobile account, the customer's advance). */
  tenders: z.array(tenderSchema).max(8).optional(),
  /** The older single-payment form. */
  paymentAmount: z.string().max(24).optional(),
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
    const { paymentAmount, paymentMethod, tenders, ...rest } = parsed.data;
    const legacyMethod = paymentMethod === "OTHER" || !paymentMethod ? "CASH" : paymentMethod;
    const result = await postInvoice({
      ...actor,
      ...rest,
      idempotencyKey: key,
      tenders: tenders ?? (paymentAmount && Number(paymentAmount) !== 0 ? [{ method: legacyMethod, amount: paymentAmount }] : []),
      allowDiscount: session.permissions.has("sales.discount"),
      allowPriceOverride: session.permissions.has("sales.price_override"),
      allowPriceLevel: session.permissions.has("sales.price_level"),
    });
    if (!result.ok) {
      return jsonError(result.code, result.message, result.status);
    }
    return jsonOk(
      { id: result.id, number: result.number, total: result.total, paid: result.paid, due: result.due, replayed: result.replayed },
      "Operation completed",
      result.replayed ? 200 : 201,
    );
  },
});
