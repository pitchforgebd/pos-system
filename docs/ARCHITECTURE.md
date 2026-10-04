# Architecture

**Status:** Frozen  
**Source:** `advanced_pos_erp_master_blueprint.md`  
**Phase:** 00 — Architecture Freeze

## 1. Stack

| Layer | Choice |
| --- | --- |
| Application | Next.js, React, TypeScript strict |
| UI | Tailwind CSS, accessible reusable components |
| Forms | React Hook Form + Zod |
| Server data | TanStack Query where client caching is appropriate |
| API | Next.js route handlers under `/api/v1` |
| Domain | Services and domain rules, not JSX |
| Data | Prisma, MySQL 8+ |
| Hosting | cPanel Node.js application, MySQL, environment variables, SSL. The release steps are in `docs/CPANEL.md`. |

Do not introduce microservices. A modular monolith is the deployment shape.

## 2. Request path

```text
UI
→ Authentication
→ Authorization / RBAC
→ Organization + Branch scope
→ Request validation
→ Application service
→ Business rules
→ Database transaction
→ Ledger / accounting / audit
→ Response
→ UI / print / notification
```

Presentation components do not run database queries, financial calculations, inventory mutations, authorization decisions, or accounting.

## 3. Layers

| Layer | Owns |
| --- | --- |
| Presentation | Pages, layout, forms, tables, POS view |
| API | Route handlers, DTO validation, response envelope |
| Application | Use cases, transaction orchestration |
| Domain | Calculations, state transitions, invariants |
| Infrastructure | Prisma, MySQL, SMTP, SMS provider, file storage |

Shared infrastructure lives in `src/lib` and `src/server`. Feature modules live in `src/modules/<name>` with `domain`, `application`, `infrastructure`, `schemas`, `types`, and `tests` when that module is implemented.

## 4. Folder structure

Freeze this layout. Create directories only when a phase needs them.

```text
src/
├── app/
│   ├── (auth)/
│   ├── (dashboard)/
│   └── api/v1/
├── components/
│   ├── ui/
│   ├── layout/
│   ├── forms/
│   ├── tables/
│   ├── charts/
│   ├── pos/
│   └── shared/
├── modules/
│   ├── auth/
│   ├── products/
│   ├── inventory/
│   ├── sales/
│   ├── purchases/
│   ├── customers/
│   ├── suppliers/
│   ├── accounting/
│   ├── loyalty/
│   ├── sms/
│   ├── crm/
│   ├── shifts/
│   ├── reports/
│   └── audit/
├── lib/
│   ├── db/
│   ├── auth/
│   ├── permissions/
│   ├── validation/
│   ├── errors/
│   ├── logging/
│   ├── money/
│   └── storage/
├── server/
│   ├── services/
│   └── repositories/
├── config/
└── tests/
prisma/
├── schema.prisma
└── seed.ts
docs/
```

`prisma/` stays at the repository root, which is the Prisma default. The blueprint also shows `src/prisma/`; that nested path is not used, so Prisma CLI and migrations stay standard. This is a tooling placement, not a domain change.

## 5. Modules

```text
auth, organizations, branches, warehouses, racks,
users, roles, permissions, products, categories, brands, units,
variations, inventory, sales, purchases, returns, customers, suppliers,
quotations, requisitions, accounting, payments, expenses, income,
assets, liabilities, loans, capital, shifts, cash, banks, loyalty,
sms, crm, notifications, reports, files, settings, audit, api-logs
```

## 6. Tenancy and branches

```text
Organization
 ├─ Branch
 │   └─ Warehouse / godown
 │       └─ Rack
 ├─ Users
 ├─ Products
 ├─ Customers
 ├─ Suppliers
 └─ Accounts
```

Rules:

- Authenticate first.
- Resolve organization, user, and branch access from the server session.
- Ignore client-supplied `organizationId`, `branchId`, `userId`, and `roleId` as authority.
- A user of organization A cannot read or write organization B.
- A user cannot operate a branch outside `user_branch_access`.

## 7. UI shell

Desktop: sidebar, header (logo, search, branch, notifications, user), breadcrumbs, page title, actions, content.

Mobile: drawer navigation, usable tables, touch-sized controls, forms that stack.

Design tokens: primary, secondary, background, surface, border, text, muted text, success, warning, error, info. Consistent type, spacing, radius, buttons, and form fields.

Phase 01 builds this shell and the component set in blueprint section 7. Phase 02 fills every route in section 9 with mock data and loading, empty, and error states.

## 8. UI route map

```text
/login
/forgot-password
/reset-password

/dashboard

/pos
/pos/open-tickets
/pos/history

/sales
/sales/new
/sales/[id]
/sales/returns
/sales/invoices

/purchases
/purchases/new
/purchases/[id]
/purchases/returns

/products
/products/new
/products/[id]
/products/brands
/products/categories
/products/units
/products/variations
/products/import
/products/barcodes
/products/barcodes/report

/inventory
/inventory/stock
/inventory/summary
/inventory/alerts
/inventory/ledger
/inventory/transfers
/inventory/damage
/inventory/expiry
/inventory/opening-stock
/inventory/own-stock

/customers
/customers/new
/customers/[id]
/customers/payments
/customers/advances
/customers/installments
/customers/loyalty
/customers/loyalty/cards
/customers/loyalty/tiers
/customers/invoices

/suppliers
/suppliers/new
/suppliers/[id]
/suppliers/payments
/suppliers/returns
/suppliers/ledger

/quotations
/requisitions

/accounting
/accounting/bank-cash
/accounting/transactions
/accounting/expenses
/accounting/income
/accounting/vouchers
/accounting/assets
/accounting/liabilities
/accounting/loans
/accounting/capital
/accounting/accounts
/accounting/journals
/accounting/statements

/shifts

/sms
/sms/dashboard
/sms/templates
/sms/send
/sms/history
/sms/settings
/sms/recharge

/crm

/reports
/reports/sales
/reports/purchases
/reports/inventory
/reports/customers
/reports/suppliers
/reports/cash
/reports/bank
/reports/profit-loss
/reports/trial-balance
/reports/day-book

/branches
/warehouses
/racks
/users
/roles
/permissions
/audit-logs
/api-logs
/settings
```

Additional product navigation from the reference that must appear inside these areas:

- Opening stock invoices, bulk opening stock, own-stock invoices
- Stock transfer create, list, and history
- Customer types
- Bill SMS format and due-collection SMS format

## 9. API, errors, and money

- HTTP API prefix: `/api/v1`
- Success and error envelopes: `docs/API.md`
- Typed errors: validation, authorization, authentication, not found, conflict, business rule, database, external service
- Production responses omit stack traces, raw database errors, and secrets
- Money is decimal, never a binary float as the financial authority
- Quantities that can be fractional use decimal with scale 4

## 10. Engines

**Inventory.** `stock_balances` is the current quantity. `stock_ledgers` is the history. No stock change without a ledger row. Formula and movement types: `docs/BUSINESS_RULES.md`.

**Accounting.** One accounting service posts journals. A posted journal is balanced. Corrections are reversals or adjustments. Source modules do not update cash or receivable balances ad hoc.

**SMS.** A provider interface. Vendor code stays behind that interface. Credentials stay in environment variables.

**Documents.** Numbers such as `INV-2026-000001` are allocated inside the same database transaction as the document.

**Idempotency.** Sale, purchase, return, payment, advance, transfer, adjustment, opening stock, own stock, loyalty redemption, shift close, and accounting post accept an idempotency key.

## 11. Phase boundaries

| Phase | Allowed outcome |
| --- | --- |
| 00 | These documents only |
| 01 | Design system, shell, dashboard visual foundation, mock data |
| 02 | Every route above, visual states only, no real mutations |
| 03 | Reviewed Prisma schema, migration, seed |
| 04+ | Real behavior for that phase only |

## 12. Conflict held for approval

**Stock transfer.** The blueprint status flow is Draft → Pending Approval → Approved → Transferred → Received. The same section posts `TRANSFER_OUT` and `TRANSFER_IN` together. The development rules also forbid stock leaving the source without arriving at the destination.

Those two descriptions disagree about whether stock is in transit.

No schema or service will pick a winner until this is approved. Proposed options are in `docs/BUSINESS_RULES.md`. Phase 05 must not start the transfer workflow until one option is accepted.

## 13. Tooling placement note

Prisma schema path is `prisma/schema.prisma` at the repository root. See section 4.
