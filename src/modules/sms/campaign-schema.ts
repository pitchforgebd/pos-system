import { z } from "zod";

// The body a campaign form sends (P10): the message, an optional offer text and the segment's filters.
export const filterSchema = z.object({
  field: z.enum(["DISTRICT", "CUSTOMER_TYPE", "LAST_PURCHASE_BEFORE", "LAST_PURCHASE_AFTER", "TOTAL_PURCHASE_MIN", "TOTAL_PURCHASE_MAX", "HAS_DUE", "DUE_OLDER_THAN_DAYS", "BOUGHT_PRODUCT", "BOUGHT_CATEGORY"]),
  value: z.string().trim().min(1).max(64),
});

export const messageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  offerText: z.string().trim().max(500).nullable().optional(),
  filters: z.array(filterSchema).max(200),
});

export const campaignSchema = messageSchema.extend({
  name: z.string().trim().min(1).max(191),
  kind: z.enum(["OFFER", "DUE_REMINDER"]),
  templateId: z.string().uuid().nullable().optional(),
});
