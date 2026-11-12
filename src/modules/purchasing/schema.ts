import { z } from "zod";

import { isoDate } from "@/core/time/iso-date";

// What a purchase request carries (the same shape for a new purchase and for changing one). Amounts stay text: they are read, with their
// decimals checked, by the purchasing module.

const id = z.string().uuid();

export const purchaseLineBody = z.object({
  productId: id,
  variantId: id.optional(),
  quantity: z.string().max(24),
  unitCost: z.string().max(24),
  discount: z.string().max(24).optional(),
  vatRate: z.string().max(8).optional(),
  lot: z.string().trim().min(1).max(64).optional(),
  manufacturedOn: isoDate.optional(),
  expiresOn: isoDate.optional(),
  serials: z.array(z.string().trim().min(1).max(64)).max(2000).optional(),
});

export const purchaseBody = z.object({
  supplierId: id,
  businessDate: isoDate,
  warehouseId: id.optional(),
  supplierInvoiceNo: z.string().trim().max(64).optional(),
  note: z.string().trim().max(500).optional(),
  headerDiscount: z.string().max(24).optional(),
  transportCost: z.string().max(24).optional(),
  otherCost: z.string().max(24).optional(),
  transporterId: id.optional(),
  vehicleNo: z.string().trim().max(32).optional(),
  transportPaidWith: z.enum(["CASH", "BANK", "CREDIT"]).optional(),
  lines: z.array(purchaseLineBody).min(1).max(200),
});

/** What can be done when the goods are received: the day they came, and a payment made at the same time. */
export const receiveBody = z.object({
  receivedOn: isoDate.optional(),
  paymentAmount: z.string().max(24).optional(),
  paymentMethod: z.enum(["CASH", "BANK", "MOBILE"]).optional(),
  paymentAccountId: id.optional(),
});

export const newPurchaseBody = purchaseBody.merge(receiveBody).extend({
  /** How far to take the new purchase: written down, sent to the vendor, or received at once. */
  mode: z.enum(["draft", "ordered", "received"]).default("received"),
});

export const paymentBody = z.object({
  businessDate: isoDate,
  amount: z.string().max(24),
  method: z.enum(["CASH", "BANK", "MOBILE"]),
  accountId: id.optional(),
  charge: z.string().max(24).optional(),
  /** The bills this payment is for; the rest settles the oldest debt. */
  allocations: z.array(z.object({ billId: id, amount: z.string().max(24) })).max(100).optional(),
});

export const advanceBody = z.object({
  businessDate: isoDate,
  amount: z.string().max(24),
  method: z.enum(["CASH", "BANK", "MOBILE"]),
  accountId: id.optional(),
});

export const applyAdvanceBody = z.object({
  businessDate: isoDate,
  amount: z.string().max(24),
  allocations: z.array(z.object({ billId: id, amount: z.string().max(24) })).max(100).optional(),
});
