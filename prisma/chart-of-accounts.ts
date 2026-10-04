/** Suggested chart from docs/DATABASE.md. Balances are not seeded. */
export const accountGroups = [
  { code: "1000", name: "Assets" },
  { code: "2000", name: "Liabilities" },
  { code: "3000", name: "Equity" },
  { code: "4000", name: "Revenue" },
  { code: "5000", name: "Cost of Sales" },
  { code: "6000", name: "Expenses" },
] as const;

export const accounts = [
  { code: "1100", name: "Cash", groupCode: "1000" },
  { code: "1200", name: "Bank", groupCode: "1000" },
  { code: "1300", name: "Accounts Receivable", groupCode: "1000" },
  { code: "1400", name: "Inventory", groupCode: "1000" },
  { code: "2100", name: "Accounts Payable", groupCode: "2000" },
  { code: "2200", name: "Loans", groupCode: "2000" },
  { code: "2300", name: "VAT Payable", groupCode: "2000" },
  { code: "3100", name: "Owner Capital", groupCode: "3000" },
  { code: "3200", name: "Drawings", groupCode: "3000" },
  { code: "4100", name: "Sales", groupCode: "4000" },
  { code: "4200", name: "Other Income", groupCode: "4000" },
  { code: "5100", name: "COGS", groupCode: "5000" },
  { code: "6100", name: "Rent", groupCode: "6000" },
  { code: "6200", name: "Salary", groupCode: "6000" },
  { code: "6300", name: "Utilities", groupCode: "6000" },
  { code: "6400", name: "Marketing", groupCode: "6000" },
] as const;
