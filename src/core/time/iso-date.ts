import { z } from "zod";

import { isIsoDate } from "@/core/time/business-date";

/**
 * Zod schema for a business date in an API body or query: a real calendar day written as YYYY-MM-DD.
 * An impossible date such as 2026-02-31 is a validation error (400), not an exception later (500).
 * Server code only: it pulls in zod, so client components import `business-date` instead.
 */
export const isoDate = z.string().refine(isIsoDate, { message: "Enter a valid date (YYYY-MM-DD)." });
