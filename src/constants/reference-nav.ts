export type ReferenceChild = { label: string; href?: string };

export type ReferenceEntry =
  | { kind: "label"; label: string }
  | { kind: "link"; label: string; href?: string }
  | { kind: "group"; label: string; children: ReferenceChild[] };

export const referenceNavigation: ReferenceEntry[] = [
  {
    kind: "group",
    label: "Open Ticket",
    children: [
      { label: "Create Ticket", href: "/pos/open-tickets" },
      { label: "All Ticket", href: "/pos/history" },
    ],
  },
  {
    kind: "group",
    label: "Shift Management",
    children: [
      { label: "My Active Shift", href: "/shifts" },
      { label: "Close My Shift", href: "/shifts" },
      { label: "Cash Handover", href: "/shifts/handover" },
      { label: "Handover Report", href: "/shifts/handover/report" },
      { label: "Shift History", href: "/shifts" },
      { label: "Branch Ledger", href: "/accounting/statements" },
    ],
  },
  { kind: "link", label: "Main Wing Dashboard", href: "/dashboard" },
  {
    kind: "group",
    label: "Shop Setting and Others",
    children: [
      { label: "Settings", href: "/settings" },
      { label: "Roles", href: "/roles" },
      { label: "Price Levels", href: "/settings/price-levels" },
      { label: "Courier Settings", href: "/settings/courier" },
      { label: "Shipments", href: "/shipments" },
      { label: "Courier Dues", href: "/couriers" },
    ],
  },
  {
    kind: "group",
    label: "Shop Branch",
    children: [
      { label: "Branch", href: "/branches" },
      { label: "Warehouse", href: "/warehouses" },
      { label: "Rack", href: "/racks" },
      { label: "Branch Role Permission", href: "/permissions" },
      { label: "CRM", href: "/crm" },
    ],
  },
  {
    kind: "group",
    label: "Products",
    children: [
      { label: "Add New Product", href: "/products/new" },
      { label: "All Products", href: "/products" },
      { label: "Brands", href: "/products/brands" },
      { label: "Categories", href: "/products/categories" },
      { label: "Unit Types", href: "/products/units" },
      { label: "Upload Product By CSV", href: "/products/import" },
      { label: "Print Barcode / Labels", href: "/products/barcodes" },
      { label: "Barcode Print Report", href: "/products/barcodes/report" },
      { label: "Variations (New)", href: "/products/variations" },
      { label: "VAT", href: "/products/vat" },
      { label: "Expired Products List", href: "/inventory/expiry" },
    ],
  },
  {
    kind: "group",
    label: "Opening & Own Stock",
    children: [
      { label: "Own Stock", href: "/inventory/own-stock" },
      { label: "Opening Stock", href: "/inventory/opening-stock" },
    ],
  },
  { kind: "link", label: "Product Stocks", href: "/inventory/stock" },
  { kind: "link", label: "Product Summary", href: "/inventory/summary" },
  { kind: "link", label: "Stock Alert Quantity", href: "/inventory/alerts" },
  { kind: "link", label: "Product Transfer", href: "/inventory/transfers" },
  { kind: "link", label: "Product Ledger Table", href: "/inventory/ledger" },
  { kind: "link", label: "Take-off (goods out without a sale)", href: "/inventory/take-off" },
  {
    kind: "group",
    label: "Damage Products",
    children: [
      { label: "Add Damage Product", href: "/inventory/damage" },
      { label: "All Damage Products", href: "/inventory/damage" },
    ],
  },
  {
    kind: "group",
    label: "SMS Panel",
    children: [
      { label: "SMS Settings", href: "/sms/settings" },
      { label: "SMS dashboard", href: "/sms/dashboard" },
      { label: "SMS Histories", href: "/sms/history" },
      { label: "Send SMS", href: "/sms/send" },
    ],
  },
  { kind: "label", label: "OTHERS" },
  {
    kind: "group",
    label: "Customers",
    children: [
      { label: "Add New Customer", href: "/customers/new" },
      { label: "All Customers", href: "/customers" },
      { label: "Installment Reminders", href: "/customers/installments" },
    ],
  },
  {
    kind: "group",
    label: "Take Customer Due",
    children: [
      { label: "Take Payment", href: "/customers/payments" },
    ],
  },
  {
    kind: "group",
    label: "Customer Advance",
    children: [
      { label: "Advance Receive", href: "/customers/advances" },
      { label: "Advance Report", href: "/reports/customers" },
    ],
  },
  { kind: "link", label: "Sell", href: "/pos" },
  { kind: "link", label: "Sold Invoices(New)", href: "/sales/invoices" },
  { kind: "link", label: "IMEI / Serial Num. (New)", href: "/products/imei" },
  {
    kind: "group",
    label: "Warranty",
    children: [
      { label: "File New Claim", href: "/products/warranty" },
      { label: "Warranty Claims", href: "/products/warranty/claims" },
    ],
  },
  {
    kind: "group",
    label: "Return & Refunds",
    children: [
      { label: "Returnable Product", href: "/sales/returns" },
      { label: "Returned Invoice", href: "/sales/returns" },
    ],
  },
  { kind: "link", label: "Orders", href: "/orders" },
  { kind: "link", label: "Requisition", href: "/requisitions" },
  {
    kind: "group",
    label: "Quotation",
    children: [
      { label: "Create Quotation", href: "/orders/new?quotation=1" },
      { label: "All Quotation", href: "/quotations" },
    ],
  },
  { kind: "link", label: "Due Date Invoice", href: "/sales/due-dates" },
  { kind: "link", label: "Purchases", href: "/purchases" },
  { kind: "link", label: "Supplier", href: "/suppliers" },
  { kind: "link", label: "Godowns", href: "/warehouses" },
  {
    kind: "group",
    label: "Accounts & Reports",
    children: [
      { label: "Bank & Cash", href: "/accounting/bank-cash" },
      { label: "Transaction", href: "/accounting/transactions" },
      { label: "Expenses", href: "/accounting/expenses" },
      { label: "Direct/Indirect Incomes", href: "/accounting/income" },
      { label: "Vouchers", href: "/accounting/vouchers" },
      { label: "Assets", href: "/accounting/assets" },
      { label: "Liabilities", href: "/accounting/liabilities" },
      { label: "Loan", href: "/accounting/loans" },
      { label: "Capital", href: "/accounting/capital" },
      { label: "Account Statement", href: "/accounting/statements" },
      { label: "Reports", href: "/reports" },
    ],
  },
  { kind: "link", label: "Dealer Wings", href: "/customers/dealers" },
  { kind: "link", label: "Users", href: "/users" },
  { kind: "link", label: "Audit logs", href: "/audit-logs" },
];

export function referenceHrefs() {
  const hrefs = new Set<string>();
  for (const entry of referenceNavigation) {
    if (entry.kind === "link" && entry.href) {
      hrefs.add(entry.href);
    }
    if (entry.kind === "group") {
      for (const child of entry.children) {
        if (child.href) {
          hrefs.add(child.href);
        }
      }
    }
  }
  return [...hrefs];
}

export function searchReferenceNav(query: string) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) {
    return [];
  }
  const matches: { label: string; href: string }[] = [];
  for (const entry of referenceNavigation) {
    if (entry.kind === "link" && entry.href && entry.label.toLowerCase().includes(needle)) {
      matches.push({ label: entry.label, href: entry.href });
    }
    if (entry.kind === "group") {
      for (const child of entry.children) {
        if (child.href && child.label.toLowerCase().includes(needle)) {
          matches.push({ label: child.label, href: child.href });
        }
      }
    }
  }
  return matches.slice(0, 8);
}
