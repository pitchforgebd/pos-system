import assert from "node:assert/strict";
import test from "node:test";

import { concreteScreenPaths, resolveScreen, screens } from "./registry.ts";

const required = [
  "/pos",
  "/pos/open-tickets",
  "/pos/history",
  "/sales",
  "/sales/new",
  "/sales/:id",
  "/sales/returns",
  "/sales/invoices",
  "/sales/due-dates",
  "/purchases",
  "/purchases/new",
  "/purchases/:id",
  "/purchases/returns",
  "/products",
  "/products/new",
  "/products/:id",
  "/products/brands",
  "/products/categories",
  "/products/units",
  "/products/variations",
  "/products/import",
  "/products/barcodes",
  "/products/barcodes/report",
  "/inventory",
  "/inventory/stock",
  "/inventory/summary",
  "/inventory/alerts",
  "/inventory/ledger",
  "/inventory/transfers",
  "/inventory/damage",
  "/inventory/expiry",
  "/inventory/opening-stock",
  "/inventory/own-stock",
  "/customers",
  "/customers/new",
  "/customers/:id",
  "/customers/payments",
  "/customers/advances",
  "/customers/installments",
  "/customers/loyalty",
  "/customers/loyalty/cards",
  "/customers/loyalty/tiers",
  "/customers/invoices",
  "/suppliers",
  "/suppliers/new",
  "/suppliers/:id",
  "/suppliers/payments",
  "/suppliers/returns",
  "/suppliers/ledger",
  "/quotations",
  "/requisitions",
  "/accounting",
  "/accounting/bank-cash",
  "/accounting/transactions",
  "/accounting/expenses",
  "/accounting/income",
  "/accounting/vouchers",
  "/accounting/assets",
  "/accounting/liabilities",
  "/accounting/loans",
  "/accounting/capital",
  "/accounting/accounts",
  "/accounting/journals",
  "/accounting/statements",
  "/shifts",
  "/shifts/handover",
  "/shifts/handover/report",
  "/sms",
  "/sms/dashboard",
  "/sms/templates",
  "/sms/send",
  "/sms/history",
  "/sms/settings",
  "/crm",
  "/reports",
  "/reports/sales",
  "/reports/sales/products",
  "/reports/payments",
  "/reports/due-sales",
  "/reports/purchases",
  "/reports/inventory",
  "/reports/customers",
  "/reports/suppliers",
  "/reports/cash",
  "/reports/bank",
  "/reports/profit-loss",
  "/reports/trial-balance",
  "/reports/day-book",
  "/branches",
  "/warehouses",
  "/racks",
  "/users",
  "/roles",
  "/permissions",
  "/audit-logs",
  "/settings",
  "/settings/courier",
  "/products/vat",
  "/products/imei",
  "/products/warranty",
  "/products/warranty/claims",
  "/customers/dealers",
];

test("every planned screen is registered", () => {
  const paths = new Set(screens.map((screen) => screen.path));
  for (const path of required) {
    assert.equal(paths.has(path), true, path);
  }
});

test("concrete paths omit record ids", () => {
  for (const path of concreteScreenPaths()) {
    assert.equal(path.includes(":"), false);
  }
});

test("a sample sale resolves", () => {
  const match = resolveScreen(["sales", "INV-2026-000018"]);
  assert.ok(match);
  assert.equal(match.record?.id, "INV-2026-000018");
});

test("an unknown record does not resolve a row", () => {
  const match = resolveScreen(["sales", "missing"]);
  assert.ok(match);
  assert.equal(match.record, null);
});
