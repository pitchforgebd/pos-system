import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { permissionCodes } from "../permissions/codes.ts";

const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const tables = [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1]);

const required = [
  "organizations",
  "branches",
  "warehouses",
  "racks",
  "users",
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "user_branch_access",
  "sessions",
  "password_resets",
  "products",
  "product_variants",
  "product_images",
  "product_barcodes",
  "brands",
  "categories",
  "units",
  "product_prices",
  "variation_heads",
  "variation_values",
  "product_variant_values",
  "stock_balances",
  "stock_ledgers",
  "stock_transfers",
  "stock_transfer_items",
  "stock_adjustments",
  "damage_records",
  "expiry_batches",
  "opening_stocks",
  "own_stock_invoices",
  "sales",
  "sale_items",
  "sale_payments",
  "sale_returns",
  "sale_return_items",
  "invoices",
  "held_tickets",
  "held_ticket_items",
  "purchases",
  "purchase_items",
  "purchase_payments",
  "purchase_returns",
  "purchase_return_items",
  "customers",
  "customer_types",
  "customer_addresses",
  "customer_ledgers",
  "customer_payments",
  "customer_advances",
  "installments",
  "suppliers",
  "supplier_ledgers",
  "supplier_payments",
  "loyalty_tiers",
  "loyalty_cards",
  "loyalty_transactions",
  "account_groups",
  "accounts",
  "journals",
  "journal_lines",
  "vouchers",
  "expenses",
  "income",
  "assets",
  "liabilities",
  "loans",
  "capital_transactions",
  "cash_accounts",
  "bank_accounts",
  "bank_transactions",
  "shifts",
  "cash_movements",
  "cash_handovers",
  "sms_templates",
  "sms_messages",
  "sms_logs",
  "sms_recharge_requests",
  "crm_contacts",
  "crm_activities",
  "crm_assignments",
  "crm_segments",
  "settings",
  "file_assets",
  "imports",
  "import_rows",
  "audit_logs",
  "api_logs",
  "notification_logs",
  "quotations",
  "requisitions",
  "document_sequences",
  "idempotency_keys",
  "quotation_items",
  "product_serials",
  "warranty_claims",
  "couriers",
  "shipments",
  "direct_returns",
];

const frozenPermissions = [
  "dashboard.view",
  "products.view",
  "products.create",
  "products.edit",
  "products.delete",
  "products.import",
  "products.export",
  "products.cost",
  "inventory.view",
  "inventory.adjust",
  "inventory.transfer",
  "inventory.damage",
  "inventory.expiry",
  "inventory.opening",
  "inventory.takeoff",
  "sales.view",
  "sales.create",
  "sales.edit",
  "sales.cancel",
  "sales.return",
  "sales.discount",
  "sales.price_override",
  "purchase.view",
  "purchase.create",
  "purchase.edit",
  "purchase.return",
  "customers.view",
  "customers.create",
  "customers.edit",
  "customers.payment",
  "customers.advance",
  "crm.manage",
  "loyalty.manage",
  "quotations.manage",
  "requisitions.manage",
  "shifts.manage",
  "sms.manage",
  "suppliers.view",
  "suppliers.create",
  "suppliers.edit",
  "suppliers.payment",
  "accounting.view",
  "accounting.create",
  "accounting.post",
  "accounting.reverse",
  "reports.view",
  "reports.export",
  "users.view",
  "users.create",
  "users.edit",
  "users.disable",
  "roles.manage",
  "settings.manage",
  "branches.manage",
  "audit.view",
  "posting.backdate",
];

test("schema maps every frozen table and the required companions", () => {
  for (const table of required) {
    assert.equal(tables.includes(table), true, table);
  }
});

test("schema does not add deferred or rejected structures", () => {
  const present = new Set(tables);
  for (const table of ["journal_entries", "requisition_items", "currencies"]) {
    assert.equal(present.has(table), false, table);
  }
  assert.equal(schema.includes("discountType"), false);
  assert.equal(schema.includes("warrantyText"), false);
  // genericName was deferred until P04 (D-list): it is the generic name of a product, searched with the name and SKU.
  assert.equal(schema.includes("Decimal(18, 2)"), true);
  assert.equal(schema.includes("Decimal(18, 4)"), true);
});

test("seed adds demo data only when SEED_DEMO is 1 and never removes Super Admin grants", () => {
  const seed = readFileSync(new URL("../../../prisma/seed.ts", import.meta.url), "utf8");
  const demoCall = seed.indexOf("await seedDemoContent()");
  assert.notEqual(demoCall, -1);
  const guard = seed.lastIndexOf('process.env.SEED_DEMO === "1"', demoCall);
  assert.notEqual(guard, -1);
  assert.equal(seed.slice(guard, demoCall).includes("}"), false, "the demo call must sit directly inside the guard");
  assert.equal(seed.includes("rolePermission.deleteMany"), false);
});

test("seed permission codes match the frozen catalog", () => {
  assert.deepEqual([...permissionCodes], frozenPermissions);
});
