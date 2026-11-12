import { z } from "zod";

import { isoDate } from "@/core/time/iso-date";

const id = z.string().uuid();

/** How an order goes when it is dispatched: the courier and its charges, or the shop's own vehicle. */
export const shipmentBody = z.object({
  courierId: id.optional(),
  trackingCode: z.string().trim().max(64).optional(),
  outsideDhaka: z.boolean().optional(),
  deliveryCharge: z.string().max(24).optional(),
  conditionPercent: z.string().max(8).optional(),
  codAmount: z.string().max(24).optional(),
  deliveryPaidWith: z.enum(["DEDUCT", "CASH", "BANK"]).optional(),
  deliveryAccountId: id.optional(),
  vehicleNo: z.string().trim().max(32).optional(),
  driverName: z.string().trim().max(191).optional(),
  driverPhone: z.string().trim().max(32).optional(),
});

export const moveBody = z.object({ note: z.string().trim().max(255).optional(), on: isoDate.optional() });

export const returnBody = z.object({ businessDate: isoDate, returnCharge: z.string().max(24).optional(), reason: z.string().trim().max(255).optional() });

export const settleBody = z.object({
  shipmentIds: z.array(id).min(1).max(500),
  businessDate: isoDate,
  netReceived: z.string().max(24),
  accountId: id.optional(),
  differenceReason: z.string().trim().max(255).optional(),
});

export const courierBody = z.object({
  name: z.string().trim().min(2).max(191),
  phone: z.string().trim().max(32).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  defaultConditionPercent: z.string().max(8).optional(),
  defaultDeliveryCharge: z.string().max(24).optional(),
  outsideDeliveryCharge: z.string().max(24).optional(),
});
