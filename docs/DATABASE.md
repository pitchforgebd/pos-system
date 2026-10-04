# Database

**Status:** Entity freeze for Phase 03 review  
**Source:** `advanced_pos_erp_master_blueprint.md` section 44  
**Phase:** 00 — Architecture Freeze

This is not a Prisma schema. Phase 03 reviews relationships, indexes, unique keys, tenant scope, and financial links, then writes `prisma/schema.prisma` and a migration.

## 1. Engine

MySQL 8+, Prisma. Identifiers are database-generated. Application code does not concatenate SQL from user input.

## 2. Conventions

| Topic | Rule |
| --- | --- |
| Primary key | Surrogate id on every table |
| Tenant | `organizationId` on every tenant-owned row |
| Branch | `branchId` where the row is branch-specific |
| Location | `warehouseId` where stock is located in a godown |
| Attribution | `createdBy` and `updatedBy` on business documents |
| Time | `createdAt`, `updatedAt` |
| Soft delete | `deletedAt` where the blueprint marks the entity as soft-deleted (products explicitly). Other entities get `deletedAt` only when history must survive a hide action. Financial and stock ledger rows are not hard-deleted. |
| Money | `DECIMAL(18,2)` |
| Quantity | `DECIMAL(18,4)` |
| JSON | Avoid. Use tables when the value is filtered, reported, or constrained. Audit `before` / `after` snapshots are the allowed exception. |

Client-supplied organization, branch, and user ids are not written as authority. The server sets them from the session.

## 3. Ownership chain

```text
organizations
  branches
    warehouses
      racks
  users ── user_roles ── roles ── role_permissions ── permissions
  users ── user_branch_access ── branches
  sessions, password_resets
```

Products, customers, suppliers, accounts, sales, purchases, stock, SMS, and CRM rows hang off `organizations`, and off `branches` when the operation is branch-local.

## 4. Table catalog

Names below are the frozen table set. Column detail is the minimum the blueprint already names. Phase 03 adds keys and indexes after review. It does not add tables that change this catalog without an approved architecture note.

### Organization and access

`organizations`, `branches`, `warehouses`, `racks`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_branch_access`, `sessions`, `password_resets`

### Products

`products`, `product_variants`, `product_images`, `product_barcodes`, `brands`, `categories`, `units`, `product_prices`

Product columns already named:

```text
id, organizationId, sku, name, slug, description, brandId, categoryId, unitId,
purchasePrice, sellingPrice, wholesalePrice, minimumPrice, vatType, vatValue,
trackStock, trackExpiry, trackBatch, trackSerial, reorderLevel,
warrantyAvailable, status, createdAt, updatedAt, deletedAt
```

The reference form also needs discount type, image, alert quantity, warranty text, and barcode. Alert quantity maps to `reorderLevel`. Barcode is `product_barcodes` (and variant barcode). Image is `product_images`. Discount type and warranty text are still unspecified beyond the visible form. Phase 03 must include them only after the field list in the open-questions section is confirmed.

Variant attributes already named: SKU, barcode, price, stock, image, manufacture date, expiry date, weight. Variation heads and items (for example Color / Black) need `variation_heads` and `variation_values` or an equivalent pair. Those two tables are required by the variation model and are added to this catalog:

- `variation_heads`
- `variation_values`
- `product_variant_values` (which values a variant uses)

### Inventory

`stock_balances`, `stock_ledgers`, `stock_transfers`, `stock_transfer_items`, `stock_adjustments`, `damage_records`, `expiry_batches`, `opening_stocks`, `own_stock_invoices`

Movement types stored on ledger rows:

```text
OPENING, PURCHASE, SALE, CUSTOMER_RETURN, SUPPLIER_RETURN,
TRANSFER_IN, TRANSFER_OUT, DAMAGE, EXPIRY, ADJUSTMENT, OWN_STOCK
```

A ledger row records product, variant when present, branch, warehouse when present, quantity, direction, movement type, reference type, reference id, user, timestamp, and unit cost when the operation has a cost.

`stock_balances` is a projection of the ledger for the same product, variant, branch, and warehouse. Reconciliation must be able to rebuild it from `stock_ledgers`.

### Sales and purchases

`sales`, `sale_items`, `sale_payments`, `sale_returns`, `sale_return_items`, `invoices`, `held_tickets`

`purchases`, `purchase_items`, `purchase_payments`, `purchase_returns`, `purchase_return_items`

### Customers and suppliers

`customers`, `customer_types`, `customer_addresses`, `customer_ledgers`, `customer_payments`, `customer_advances`, `installments`

Customer fields already named: name, phone, email, address, customer type, opening balance, credit limit, payment terms, status.

`suppliers`, `supplier_ledgers`, `supplier_payments`

Supplier fields already named: name, phone, email, address, opening payable, credit limit, payment terms, status.

### Loyalty

`loyalty_tiers`, `loyalty_cards`, `loyalty_transactions`

Tier fields: name, minimum spend, discount percent, benefits note, status.

Card fields: card number, customer, type, tier, status, issued, expires.

Loyalty ledger types: `EARN`, `REDEEM`, `EXPIRE`, `ADJUST`, `REVERSAL`.

### Accounting

`account_groups`, `accounts`, `journals`, `journal_entries`, `journal_lines`, `vouchers`, `expenses`, `income`, `assets`, `liabilities`, `loans`, `capital_transactions`, `cash_accounts`, `bank_accounts`, `bank_transactions`

Suggested seed chart (configurable, not a hardcoded limit):

```text
1000 Assets
  1100 Cash
  1200 Bank
  1300 Accounts Receivable
  1400 Inventory
2000 Liabilities
  2100 Accounts Payable
  2200 Loans
3000 Equity
  3100 Owner Capital
  3200 Drawings
4000 Revenue
  4100 Sales
5000 Cost of Sales
  5100 COGS
6000 Expenses
  6100 Rent
  6200 Salary
  6300 Utilities
  6400 Marketing
```

Posted `journal_lines` for one journal must satisfy sum of debits = sum of credits. Enforce in the posting service. A database check constraint is preferred if MySQL can express it without blocking draft journals. Draft versus posted must be an explicit status so drafts are excluded from that invariant.

The blueprint lists both `journals` and `journal_entries`. Resolved at the start of Phase 03: `journals` is the header, `journal_lines` are the lines, and `journal_entries` is not created.

### Shifts and cash

`shifts`, `cash_movements`, `cash_handovers`

Shift states: `OPEN`, `ACTIVE`, `CLOSING`, `CLOSED`.

### SMS, CRM, files, platform

`sms_templates`, `sms_messages`, `sms_logs`, `sms_recharge_requests`

`crm_contacts`, `crm_activities`, `crm_assignments`, `crm_segments`

`settings`, `file_assets`, `imports`, `import_rows`, `audit_logs`, `api_logs`, `notification_logs`

Quotations and requisitions are in the route map and phase 11, but they are not in the blueprint table list. Phase 11 cannot ship without tables. Proposed names, not migrated in Phase 03 unless Phase 03 is explicitly told to include them:

- `quotations`, `quotation_items`
- `requisitions`, `requisition_items`

## 5. Document numbers

Allocated inside the document transaction. Unique per organization and document type.

```text
INV-2026-000001
PUR-2026-000001
RET-2026-000001
QUO-2026-000001
REQ-2026-000001
TRF-2026-000001
PAY-2026-000001
EXP-2026-000001
VCH-2026-000001
```

Phase 03 adds `document_sequences` with organization, document type, year, and last value. Document numbers stay unique per organization. A branch column is not included, because branch-local numbering is still an open decision. Allocation must lock the sequence row inside the document transaction. The service that does that arrives with the phase that issues the document.

## 6. Indexes to review in Phase 03

Do not add indexes blindly. Review composites for the real filters.

Phase 17 added indexes only where `EXPLAIN` showed the chosen key did not cover the filter:

- `users.email`, because login looks up email without an organization id and the organization-plus-email unique key was scanned
- `products (organizationId, deletedAt, name)`, because the product list sorts by name after an organization filter and `EXPLAIN` reported a filesort
- `stock_ledgers (organizationId, branchId, createdAt)`, because the ledger list orders by time. `EXPLAIN` can still filesort that list while the table is empty, because an older organization prefix looks cheaper. The new index is listed as a possible key.
- `sale_payments (organizationId, method, createdAt)`, because shift cash sales filtered method and time after the organization foreign key. `EXPLAIN` now uses this index.
- `journals (organizationId, branchId, status, occurredOn)`, because posted reports filter branch, status, and date. On a small table `EXPLAIN` can still start from the organization-and-number key. The new index is listed as a possible key.

- `organizationId` plus `branchId` on operational tables
- `productId`, `customerId`, `supplierId`
- invoice number, SKU, barcode
- `createdAt`, transaction date, status
- stock ledger by product, variant, branch, created time
- journal lines by account and date

Known uniqueness to enforce:

- Product SKU unique per organization among non-deleted products
- Variant SKU unique per organization
- Barcode unique per organization
- Document number unique per organization
- Permission code unique globally
- Role name unique per organization
- User email unique per organization
- Loyalty card number unique per organization
- A user has at most one membership row per role
- A user has at most one access row per branch

Phone uniqueness is not specified. Do not add it until the business confirms it.

## 7. Idempotency

Sensitive creates store the idempotency key, organization, user, request hash, and resulting entity id. Replay of the same key and same payload returns the original result. The same key with a different payload is a conflict.

## 8. Audit row

```text
organizationId, branchId, userId, action, module, entityType, entityId,
before, after, ip, userAgent, createdAt
```

`before` and `after` must not contain passwords, session tokens, or API secrets.

## 9. Open schema questions

These stay open. Phase 03 does not guess them.

1. Transfer in-transit representation. See `docs/BUSINESS_RULES.md`. The transfer status list is stored. No in-transit location is modeled.
2. Resolved: `journal_entries` is not a table. Header is `journals`. Lines are `journal_lines`.
3. `stock_ledgers.unitCost` is nullable. No costing method is stored.
4. Discount type and warranty text are not columns. `warrantyAvailable` remains the named flag.
5. Sequences are per organization, type, and year. Branch-local sequences are not modeled.
6. Phase 11 adds `quotations` and `requisitions` as headers only. `quotation_items` and `requisition_items` stay absent because line fields are not defined.
7. No currency table and no currency column. Settings can hold a code later. The seed does not set one.

Phase 03 also adds `idempotency_keys` for section 7, and `held_ticket_items` so a held cart can be stored without JSON. `variation_heads`, `variation_values`, and `product_variant_values` are the variation tables already named in section 4.
