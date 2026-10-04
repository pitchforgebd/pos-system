/**
 * SAMPLE DATA for the Phase 01 visual foundation.
 * These figures are not ledger balances, stock quantities, or saved documents.
 * Currency display uses BDT until organization settings exist.
 */

export const sampleBranches = ["Main Branch", "Depot Branch"] as const;

export const sampleKpis = [
  { id: "sales", label: "Today's sales", amount: 186450, hint: "18 invoices" },
  { id: "purchase", label: "Today's purchase", amount: 94200, hint: "4 receipts" },
  { id: "profit", label: "Gross profit", amount: 41280, hint: "Sample figure" },
  { id: "customer-due", label: "Customer due", amount: 76340, hint: "12 accounts" },
  { id: "supplier-payable", label: "Supplier payable", amount: 128900, hint: "6 accounts" },
  { id: "cash", label: "Cash balance", amount: 54320, hint: "Main Branch" },
  { id: "bank", label: "Bank balance", amount: 310450, hint: "Operating account" },
  { id: "low-stock", label: "Low stock", amount: 7, hint: "At or below alert", money: false },
] as const;

export const sampleSalesTrend = [
  { label: "24 Sep", value: 98000 },
  { label: "25 Sep", value: 112400 },
  { label: "26 Sep", value: 86400 },
  { label: "27 Sep", value: 143200 },
  { label: "28 Sep", value: 121000 },
  { label: "29 Sep", value: 156800 },
  { label: "30 Sep", value: 186450 },
];

export const samplePurchaseTrend = [
  { label: "24 Sep", value: 42000 },
  { label: "25 Sep", value: 18000 },
  { label: "26 Sep", value: 76000 },
  { label: "27 Sep", value: 24000 },
  { label: "28 Sep", value: 51000 },
  { label: "29 Sep", value: 33000 },
  { label: "30 Sep", value: 94200 },
];

export const samplePayments = [
  { label: "Cash", percent: 46 },
  { label: "Card", percent: 28 },
  { label: "Bank", percent: 14 },
  { label: "Due", percent: 12 },
];

export const sampleTopProducts = [
  { name: "Green tea 500g", units: "42 sold" },
  { name: "Basmati rice 5kg", units: "31 sold" },
  { name: "Sunflower oil 2L", units: "27 sold" },
  { name: "Milk powder 1kg", units: "19 sold" },
];

export const sampleAlerts = [
  {
    id: "low-stock",
    tone: "warning" as const,
    title: "Low stock",
    description: "7 sample products are at or below their alert quantity.",
  },
  {
    id: "expired",
    tone: "error" as const,
    title: "Expired products",
    description: "2 sample lots show an expiry date before today.",
  },
  {
    id: "transfer",
    tone: "info" as const,
    title: "Pending transfer",
    description: "1 sample transfer is waiting to be received.",
  },
  {
    id: "due",
    tone: "warning" as const,
    title: "Outstanding due",
    description: "Sample customer balances are still open on 12 accounts.",
  },
];

export type SampleSaleStatus = "Paid" | "Partial" | "Due";

export type SampleSale = {
  id: string;
  invoice: string;
  date: string;
  customer: string;
  branch: (typeof sampleBranches)[number];
  status: SampleSaleStatus;
  total: number;
};

export const sampleSales: SampleSale[] = [
  { id: "s1", invoice: "INV-2026-000018", date: "2026-09-30", customer: "City Grocers", branch: "Main Branch", status: "Paid", total: 12450 },
  { id: "s2", invoice: "INV-2026-000017", date: "2026-09-30", customer: "Walk-in customer", branch: "Main Branch", status: "Paid", total: 860 },
  { id: "s3", invoice: "INV-2026-000016", date: "2026-09-30", customer: "North Wharf Store", branch: "Depot Branch", status: "Partial", total: 24800 },
  { id: "s4", invoice: "INV-2026-000015", date: "2026-09-29", customer: "Lakeside Mart", branch: "Main Branch", status: "Due", total: 9600 },
  { id: "s5", invoice: "INV-2026-000014", date: "2026-09-29", customer: "Walk-in customer", branch: "Depot Branch", status: "Paid", total: 430 },
  { id: "s6", invoice: "INV-2026-000013", date: "2026-09-29", customer: "Harbor Pantry", branch: "Main Branch", status: "Paid", total: 15720 },
  { id: "s7", invoice: "INV-2026-000012", date: "2026-09-28", customer: "City Grocers", branch: "Depot Branch", status: "Partial", total: 18640 },
  { id: "s8", invoice: "INV-2026-000011", date: "2026-09-28", customer: "Riverside Wholesale", branch: "Main Branch", status: "Due", total: 31200 },
  { id: "s9", invoice: "INV-2026-000010", date: "2026-09-27", customer: "Walk-in customer", branch: "Main Branch", status: "Paid", total: 1190 },
  { id: "s10", invoice: "INV-2026-000009", date: "2026-09-27", customer: "North Wharf Store", branch: "Main Branch", status: "Paid", total: 22150 },
  { id: "s11", invoice: "INV-2026-000008", date: "2026-09-26", customer: "Lakeside Mart", branch: "Depot Branch", status: "Due", total: 7400 },
  { id: "s12", invoice: "INV-2026-000007", date: "2026-09-26", customer: "Harbor Pantry", branch: "Depot Branch", status: "Paid", total: 5320 },
];

export const sampleSearch = [
  { label: "INV-2026-000018", kind: "Invoice", href: "/sales" },
  { label: "Green tea 500g", kind: "Product", href: "/products" },
  { label: "City Grocers", kind: "Customer", href: "/customers" },
  { label: "Rahim Traders", kind: "Supplier", href: "/suppliers" },
  { label: "Low stock", kind: "Inventory", href: "/inventory" },
];

export const sampleCategories = [
  { value: "beverages", label: "Beverages" },
  { value: "grocery", label: "Grocery" },
  { value: "personal-care", label: "Personal care" },
];

export const sampleUnits = [
  { value: "pcs", label: "Piece" },
  { value: "kg", label: "Kilogram" },
  { value: "ltr", label: "Litre" },
];

export const sampleNotifications = [
  { id: "n1", title: "Low stock", detail: "Green tea 500g is in the sample alert list." },
  { id: "n2", title: "Transfer waiting", detail: "A sample transfer has not been received." },
];
