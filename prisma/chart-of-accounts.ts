import type { AccountRole } from "../src/core/ledger/roles.ts";

// The chart of accounts v2 (docs/meridian-v2/v2/02_ACCOUNTING_MODEL.md section 1). This file is the only place in the
// code that may write an account number: everything else asks for a role (accountFor). Balances are not seeded.
// Used by the seed, by ensureChart (which also upgrades an organization that has the older chart) and by the test harness.

export const accountGroups = [
  { code: "1000", name: "Assets" },
  { code: "2000", name: "Liabilities" },
  { code: "3000", name: "Equity" },
  { code: "4000", name: "Revenue" },
  { code: "5000", name: "Cost of Sales" },
  { code: "6000", name: "Expenses" },
] as const;

export type ChartAccount = {
  code: string;
  name: string;
  groupCode: (typeof accountGroups)[number]["code"];
  /** The part the account plays. An account with a role is a system account: it cannot be closed or deleted. */
  role?: AccountRole;
  /** Cash, bank or mobile money; every other account is OTHER. */
  kind?: "CASH" | "BANK" | "MOBILE";
  /** Names this account had in the first version of the chart; an account that still has one is renamed to `name`. */
  oldNames?: readonly string[];
};

export const accounts: readonly ChartAccount[] = [
  { code: "1100", name: "Cash in Hand", groupCode: "1000", role: "CASH", kind: "CASH", oldNames: ["Cash"] },
  // The default bank account: card and bank sales and receipts land here unless a specific bank account is chosen.
  // Banks the owner adds are numbered from 1201 (1201-1249); mobile banking accounts from 1251 (1251-1279).
  { code: "1200", name: "Bank (default)", groupCode: "1000", role: "BANK:DEFAULT", kind: "BANK", oldNames: ["Bank"] },
  { code: "1300", name: "Accounts Receivable", groupCode: "1000", role: "AR" },
  { code: "1350", name: "Courier Receivable", groupCode: "1000", role: "COURIER_AR" },
  { code: "1400", name: "Inventory", groupCode: "1000", role: "INVENTORY" },
  { code: "1450", name: "Advance to Vendor", groupCode: "1000", role: "VENDOR_ADVANCE" },
  { code: "1500", name: "Input VAT", groupCode: "1000", role: "INPUT_VAT" },
  { code: "1600", name: "Fixed Assets", groupCode: "1000", role: "FIXED_ASSET" },
  { code: "1690", name: "Accumulated Depreciation", groupCode: "1000", role: "ACCUM_DEPR" },
  { code: "2100", name: "Accounts Payable", groupCode: "2000", role: "AP" },
  { code: "2150", name: "Customer Advance", groupCode: "2000", role: "CUSTOMER_ADVANCE" },
  { code: "2200", name: "Loans Payable", groupCode: "2000", role: "LOAN", oldNames: ["Loans"] },
  { code: "2300", name: "VAT Payable (Output)", groupCode: "2000", role: "OUTPUT_VAT", oldNames: ["VAT Payable"] },
  { code: "2400", name: "Accrued Expenses", groupCode: "2000", role: "ACCRUED" },
  { code: "3100", name: "Owner Capital", groupCode: "3000", role: "CAPITAL" },
  { code: "3200", name: "Drawings", groupCode: "3000", role: "DRAWINGS" },
  { code: "3800", name: "Retained Earnings", groupCode: "3000", role: "RETAINED" },
  { code: "3900", name: "Opening Balance Equity", groupCode: "3000", role: "OPENING_EQUITY" },
  { code: "4100", name: "Sales", groupCode: "4000", role: "SALES" },
  { code: "4200", name: "Delivery & Other Charges Income", groupCode: "4000", role: "CHARGE_INCOME", oldNames: ["Other Income"] },
  { code: "4300", name: "Inventory Gain", groupCode: "4000", role: "INVENTORY_GAIN" },
  { code: "4400", name: "Other Income", groupCode: "4000", role: "OTHER_INCOME" },
  { code: "5100", name: "Cost of Goods Sold", groupCode: "5000", role: "COGS", oldNames: ["COGS"] },
  { code: "5200", name: "Inventory Loss", groupCode: "5000", role: "INVENTORY_LOSS" },
  { code: "5300", name: "Purchase Price Variance", groupCode: "5000", role: "PPV" },
  // Expense heads the owner can rename, close or add to (6000 group); they have no role.
  { code: "6100", name: "Rent", groupCode: "6000" },
  { code: "6200", name: "Salary", groupCode: "6000" },
  { code: "6300", name: "Utilities", groupCode: "6000" },
  { code: "6400", name: "Marketing & Offers", groupCode: "6000", oldNames: ["Marketing"] },
  { code: "6500", name: "Loyalty Discount", groupCode: "6000", role: "LOYALTY" },
  { code: "6600", name: "Bank Charges", groupCode: "6000", role: "BANK_CHARGE" },
  { code: "6610", name: "Mobile Banking Charges", groupCode: "6000", role: "MOBILE_CHARGE" },
  { code: "6700", name: "Transport / Delivery Expense", groupCode: "6000", role: "TRANSPORT" },
  { code: "6710", name: "Condition (COD) Charge", groupCode: "6000", role: "COD_CHARGE" },
  { code: "6800", name: "Depreciation", groupCode: "6000", role: "DEPRECIATION" },
  { code: "6900", name: "Miscellaneous", groupCode: "6000", role: "MISC" },
];
