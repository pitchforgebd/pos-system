import { z } from "zod";

import { isoDate } from "@/core/time/iso-date";
import { shipmentBody } from "@/modules/shipping/schema";

// What an order request carries. Amounts stay text; their decimals are checked by the sales and orders modules.

const id = z.string().uuid();

export const orderLineBody = z.object({
  productId: id,
  variantId: id.optional(),
  quantity: z.string().max(24),
  unitPrice: z.string().max(24).optional(),
  discountAmount: z.string().max(24).optional(),
  discountPercent: z.string().max(8).optional(),
});

export const orderBody = z.object({
  customerId: id,
  businessDate: isoDate,
  channel: z.enum(["POS", "PHONE", "FACEBOOK", "WEBSITE", "OTHER"]).optional(),
  deliveryMethod: z.enum(["PICKUP", "OWN_VEHICLE", "COURIER"]).optional(),
  shippingAddress: z.string().trim().max(255).optional(),
  districtId: id.optional(),
  upazilaId: id.optional(),
  externalRef: z.string().trim().max(64).optional(),
  expectedDate: isoDate.optional(),
  note: z.string().trim().max(500).optional(),
  warehouseId: id.optional(),
  level: z.string().trim().max(64).optional(),
  headerDiscount: z.string().max(24).optional(),
  chargesTotal: z.string().max(24).optional(),
  isQuotation: z.boolean().optional(),
  validUntil: isoDate.optional(),
  lines: z.array(orderLineBody).min(1).max(200),
});

export const dispatchBody = z.object({
  dispatchedOn: isoDate,
  /** How it goes: the courier and its charges, or the vehicle; the order's delivery method says which. */
  shipment: shipmentBody.optional(),
  tenders: z
    .array(z.object({ method: z.enum(["CASH", "BANK", "MOBILE", "CARD", "WALLET"]), accountId: id.optional(), amount: z.string().max(24), charge: z.string().max(24).optional() }))
    .max(8)
    .optional(),
});

export const cancelBody = z.object({ note: z.string().trim().max(255).optional() });
