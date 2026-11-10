import type { PartyType } from "@prisma/client";

// The parts a ledger account can play (02_ACCOUNTING_MODEL.md section 1). Code asks for a role (accountFor), never for an
// account number: the number belongs to the chart, which the owner can extend, and a role is what the posting rules mean.
export const SYSTEM_ROLES = [
  "CASH",
  "BANK:DEFAULT",
  "AR",
  "COURIER_AR",
  "INVENTORY",
  "INPUT_VAT",
  "FIXED_ASSET",
  "ACCUM_DEPR",
  "AP",
  "CUSTOMER_ADVANCE",
  "VENDOR_ADVANCE",
  "LOAN",
  "OUTPUT_VAT",
  "ACCRUED",
  "CAPITAL",
  "DRAWINGS",
  "RETAINED",
  "OPENING_EQUITY",
  "SALES",
  "CHARGE_INCOME",
  "INVENTORY_GAIN",
  "OTHER_INCOME",
  "COGS",
  "INVENTORY_LOSS",
  "PPV",
  "LOYALTY",
  "BANK_CHARGE",
  "MOBILE_CHARGE",
  "TRANSPORT",
  "COD_CHARGE",
  "DEPRECIATION",
  "MISC",
] as const;

export type AccountRole = (typeof SYSTEM_ROLES)[number];

/** The accounts whose lines must say who they are about (I2), and which kind of party that is. */
export const PARTY_ROLES = {
  AR: "CUSTOMER",
  AP: "VENDOR",
  COURIER_AR: "COURIER",
  CUSTOMER_ADVANCE: "CUSTOMER",
  VENDOR_ADVANCE: "VENDOR",
} as const satisfies Partial<Record<AccountRole, PartyType>>;

export type PartyRole = keyof typeof PARTY_ROLES;

export function isPartyRole(role: string): role is PartyRole {
  return Object.hasOwn(PARTY_ROLES, role);
}
