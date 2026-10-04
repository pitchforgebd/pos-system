# Product Requirements

**Status:** Frozen for implementation planning  
**Source:** `advanced_pos_erp_master_blueprint.md`  
**Phase:** 00 — Architecture Freeze  
**Implementation:** Not started

This document freezes what the product is. It does not implement it.

## 1. Product

A multi-branch, multi-user POS and ERP for one organization per tenant, deployed as a Next.js application on cPanel with MySQL.

The product covers selling, purchasing, inventory, customers, suppliers, accounting, shifts, SMS, CRM, and reports. Screens alone do not complete a module. A module is done only when UI, API, validation, authorization, tenant scope, branch scope, database constraints, business rules, transactions, audit, error handling, and tests all exist. See `docs/TEST_PLAN.md` and the blueprint definition of done.

Reference screenshots define information architecture and workflows only. The product must be original: no copied proprietary source, private APIs, database internals, branding, CSS, or logos.

## 2. Users

| Actor | Needs |
| --- | --- |
| Organization owner / admin | Configure branches, users, roles, settings, chart of accounts |
| Branch user | Operate only branches granted to that user |
| Cashier | Fast POS, held tickets, shift cash |
| Inventory user | Stock, transfers, damage, expiry, opening stock |
| Accountant | Journals, vouchers, bank and cash, statements, reports |
| Purchasing user | Suppliers, purchases, purchase returns |
| CRM user | Contacts, activities, follow-ups |

Every actor is a user inside one organization. Access is permission-based and branch-based. Frontend checks are for display. Server checks are the control.

## 3. In-scope capabilities

Grouped as the blueprint navigation and route map require.

- **Shell:** dashboard KPIs, charts, alerts, quick actions
- **POS and sales:** search, barcode, categories, cart, discount, VAT, charges, customer, split tender, due, hold ticket, invoice, history
- **Purchases:** supplier purchases and purchase returns
- **Products:** product, brand, category, unit, variation, CSV import, barcode labels and barcode report
- **Inventory:** balances, ledger, summary, alerts, opening stock, bulk opening stock, own stock, transfer, damage, expiry, racks
- **Customers:** types, profile, due collection, advance, sold invoices, installments, loyalty tiers and cards
- **Suppliers:** profile, purchases, payments, returns, ledger
- **Accounting:** bank and cash, transactions, expenses, direct and indirect income, vouchers, assets, liabilities, loans, capital, chart of accounts, journals, statements
- **Operations:** shifts, SMS, CRM, quotations, requisitions
- **Administration:** branches, warehouses, racks, users, roles, permissions, audit logs, API logs, settings
- **Reports:** sales, purchases, inventory, customers, suppliers, cash, bank, profit and loss, trial balance, day book
- **Output:** CSV import and export, XLSX where a later phase requires it, A4 invoice, thermal receipt, barcode labels, quotation print, voucher print

## 4. Cross-cutting requirements

- Organization isolation on every tenant-owned record
- Branch access checked on the server
- Ledger-based inventory
- Double-entry accounting with debit equal to credit on every posted journal
- Server recalculation of money totals
- Document numbers generated inside a database transaction
- Idempotency keys on sensitive create operations
- Audit records for critical mutations, without passwords, session tokens, or secrets
- Consistent API envelope under `/api/v1`
- Health check at `GET /api/health` with no secrets

## 5. Out of scope until its phase

| Work | Phase |
| --- | --- |
| Design system and app shell | 01 |
| All visual routes with mock data | 02 |
| Prisma schema, migrations, seed | 03 |
| Authentication and RBAC | 04 |
| Products and inventory | 05 |
| Purchases and suppliers | 06 |
| POS and sales | 07 |
| Returns and refunds | 08 |
| Accounting | 09 |
| Customers, CRM, loyalty | 10 |
| Quotations and requisitions | 11 |
| Shifts and cash | 12 |
| SMS and notifications | 13 |
| Reports | 14 |
| Import, export, printing | 15 |
| Security hardening | 16 |
| Performance | 17 |
| Full QA | 18 |
| cPanel deployment | 19 |
| Production verification | 20 |

Phase 00 does not create the Next.js application.

## 6. Quality bar

The finished system is production-ready only when login, dashboard, product, inventory, purchase, POS, sales, returns, customer, supplier, accounting, reports, permissions, audit, and backup/restore expectations in the blueprint all hold together.

UI phases may use mock data. Mock data must be labeled and must not be presented as a working API or database.

## 7. Open product decisions

These are not invented here. They block the phase that would implement them. Detail is in `docs/BUSINESS_RULES.md`.

- Stock-transfer timing versus in-transit stock
- Inventory costing method for COGS
- VAT inclusive versus exclusive calculation
- Negative-stock policy
- Loyalty earn and redeem rates
- Installment interest, if any
- Default currency, fiscal year, and timezone
- SMS provider vendor
