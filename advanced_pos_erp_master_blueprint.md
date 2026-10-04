# ADVANCED POS / ERP MASTER BLUEPRINT

**Purpose:** Reference-based production implementation plan for a professional POS, inventory, accounting, CRM and business-management platform.

**Stack**
- Frontend: Next.js + TypeScript
- Backend: Next.js server/API + service layer
- Database: MySQL 8+
- ORM: Prisma
- UI: Tailwind CSS + accessible reusable component system
- Validation: Zod
- Forms: React Hook Form
- Hosting: cPanel Node.js Application + MySQL
- Architecture: Secure Modular Monolith
- Development: Cursor, phase-by-phase

---

# 1. PROJECT GOAL

Build a complete commercial-grade system based on the supplied reference software's visible modules and workflows.

The application must not be a collection of simple CRUD pages. Every important business action must flow through:

```text
UI
→ Authentication
→ Authorization / RBAC
→ Organization + Branch Scope
→ Request Validation
→ Application Service
→ Business Rules
→ Database Transaction
→ Ledger / Accounting / Audit
→ Response
→ UI / Print / Notification
```

Primary capabilities:

- Dashboard
- POS / Sales
- Open Tickets
- Shift Management
- Products
- Categories
- Brands
- Unit Types
- Product Variations
- Product Import
- Barcode / Labels
- Product Stock
- Product Summary
- Stock Alerts
- Product Ledger
- Product Transfer
- Damage Products
- Expired Products
- Opening Stock
- Bulk Opening Stock
- Own Stock
- Customers
- Customer Types
- Customer Due
- Customer Advance
- Sold Invoices
- Installment Reminders
- Loyalty Tiers
- Loyalty Cards
- Suppliers
- Purchase
- Purchase Return
- Accounting
- Bank & Cash
- Transactions
- Expenses
- Direct/Indirect Income
- Vouchers
- Assets
- Liabilities
- Loan & Capital
- Account Statements
- Reports
- SMS
- CRM
- Branch / Warehouse / Rack
- Users / Roles / Permissions
- Audit / API Logs
- Settings

---

# 2. REFERENCE PDF ANALYSIS

The supplied reference is image-based. The visible screenshots show the following application structure.

## Visible navigation

```text
Open Ticket
Shift Management
Main Wing Dashboard
Shop Setting and Others
Shop Branch

Products
 ├─ Add New Product
 ├─ All Products
 ├─ Brands
 ├─ Categories
 ├─ Unit Types
 ├─ Upload Product By CSV
 ├─ Print Barcode / Labels
 ├─ Barcode Print Report
 └─ Variations

Expired Products List

Opening & Own Stock
 ├─ Opening Stock
 ├─ Set Bulk Opening Stock
 ├─ Own Stock Invoices
 └─ Opening Stock Invoices

Product Stocks
Product Summary
Stock Alert Quantity
Product Transfer
Product Ledger Table
Damage Products

SMS Panel
 ├─ SMS Dashboard
 ├─ Bill SMS Format
 ├─ Due Collection SMS Format
 ├─ SMS Settings
 ├─ SMS Histories
 ├─ Send SMS
 └─ Recharge Requests

Customers
 ├─ Customer Types
 ├─ Add New Customer
 ├─ All Customers
 ├─ Installment Reminders
 ├─ Loyalty Tiers
 ├─ Loyalty Cards
 ├─ Take Customer Due
 ├─ Customer Advance
 └─ Sold Invoices

Rack Management

Suppliers

Acc & Transaction
 ├─ Bank & Cash
 ├─ Transactions
 ├─ Expenses
 ├─ Direct / Indirect Incomes
 ├─ Vouchers
 ├─ Assets
 ├─ Liabilities
 ├─ Loan & Capital
 ├─ Reports
 └─ Account Statement

CRM
```

The reference screenshots visibly demonstrate branch/godown selection, product stock, stock alert, product transfer, damaged products, expired products, opening/own stock, categories, brands, units, variations, barcode settings, loyalty, customer due, installment reminders, SMS templates/history/recharge, bank accounts, transaction history and CRM.

## IP / implementation rule

Use the reference for functionality and information architecture only. Do not copy proprietary source code, private APIs, database internals, exact branding, exact CSS, logos or private implementation details. Build an original system.

---

# 3. ARCHITECTURE

## 3.1 Modular Monolith

Use a modular monolith because it is appropriate for the initial cPanel deployment and keeps transactions/database operations manageable.

```text
Next.js
 ├─ Presentation
 ├─ API
 ├─ Application Services
 ├─ Domain Rules
 └─ Infrastructure
       └─ Prisma
             └─ MySQL
```

Future extraction into services is possible, but do not introduce microservices prematurely.

## 3.2 Layers

```text
Presentation
  Pages / Components / Forms / POS

API
  Route handlers / DTO / validation / response

Application
  Use cases / services / transaction orchestration

Domain
  Business rules / calculations / state transitions

Infrastructure
  Prisma / MySQL / SMTP / SMS / Storage / external APIs
```

---

# 4. DOMAIN MODULES

```text
auth
organizations
branches
warehouses
racks
users
roles
permissions
products
categories
brands
units
variations
inventory
sales
purchases
returns
customers
suppliers
quotations
requisitions
accounting
payments
expenses
income
assets
liabilities
loans
capital
shifts
cash
banks
loyalty
sms
crm
notifications
reports
files
settings
audit
api-logs
```

Each module should remain understandable and independently testable.

Recommended internal pattern:

```text
module/
 ├─ domain/
 ├─ application/
 ├─ infrastructure/
 ├─ schemas/
 ├─ types/
 └─ tests/
```

---

# 5. MULTI-TENANT + BRANCH ARCHITECTURE

```text
Organization
 ├─ Branch
 │   └─ Warehouse/Godown
 │       └─ Rack
 ├─ Users
 ├─ Products
 ├─ Customers
 ├─ Suppliers
 └─ Accounts
```

Every tenant-owned query must be scoped by the authenticated organization.

Never trust `organizationId` or `branchId` supplied by the browser.

Authorization flow:

```text
Authenticate
→ Organization Scope
→ Branch Scope
→ Permission Check
→ Resource Ownership
→ Service
```

---

# 6. AUTH + RBAC

Required:

- Login/logout
- Secure password hashing
- Secure sessions
- Session expiry/revocation
- Password reset
- Login rate limiting
- Audit logging

Permission examples:

```text
dashboard.view

products.view/create/edit/delete/import/export

inventory.view/adjust/transfer/damage/expiry/opening

sales.view/create/edit/cancel/return/discount/price_override

purchase.view/create/edit/return

customers.view/create/edit/payment/advance

suppliers.view/create/edit/payment

accounting.view/create/post/reverse

reports.view/export

users.view/create/edit/disable
roles.manage
settings.manage
audit.view
```

Server-side authorization is always authoritative.

---

# 7. UI/UX DESIGN SYSTEM

The new UI must be modern, professional, responsive and original.

Avoid:

- Random spacing
- Duplicated components
- Tiny unreadable text
- Excessive visual noise
- Page-specific styling systems
- Inconsistent buttons/forms
- Client-side-only permission enforcement

Build a centralized design system.

Components:

```text
Button
IconButton
Input
Textarea
Select
Combobox
DatePicker
DateRangePicker
CurrencyInput
QuantityInput
SearchInput
FormField
DataTable
FilterBar
Pagination
StatusBadge
MoneyDisplay
StatCard
ChartCard
ConfirmDialog
Modal
Drawer
Tabs
Tooltip
Skeleton
EmptyState
ErrorState
PermissionDenied
PageHeader
Breadcrumb
PrintPreview
```

Application shell:

```text
┌──────────────────────────────────────────────────────┐
│ Logo | Search | Branch | Notification | User        │
├───────────────┬──────────────────────────────────────┤
│ Dashboard     │ Page Header                          │
│ POS           │ Breadcrumb                           │
│ Sales         │                                      │
│ Purchases     │ Main Content                         │
│ Products      │                                      │
│ Inventory     │                                      │
│ Customers     │                                      │
│ Suppliers     │                                      │
│ Accounting    │                                      │
│ Reports       │                                      │
│ CRM           │                                      │
│ SMS           │                                      │
│ Settings      │                                      │
└───────────────┴──────────────────────────────────────┘
```

All major tables need search, filters, sorting, pagination, loading, empty and error states.

---

# 8. DASHBOARD

KPIs:

```text
Today's Sales
Today's Purchase
Gross Profit
Customer Due
Supplier Payable
Cash Balance
Bank Balance
Low Stock
```

Charts:

```text
Sales Trend
Purchase Trend
Profit Trend
Payment Distribution
Top Products
Top Customers
Branch Performance
```

Alerts:

```text
Low Stock
Expired Products
Pending Transfer
Pending Delivery
Outstanding Due
Supplier Payable
Failed SMS/API
```

Quick actions:

```text
New Sale
New Purchase
Add Product
Add Customer
Take Due
Stock Transfer
Quotation
```

---

# 9. POS

POS must be optimized for speed and keyboard use.

```text
┌───────────────────────┬──────────────────────────────┐
│ Search / Categories   │ Cart                         │
│                       │ Product | Qty | Price | Disc │
│ Product Grid          │ Product | Qty | Price | Disc │
│                       │                              │
│ [P] [P] [P] [P]       │ Subtotal                     │
│ [P] [P] [P] [P]       │ Discount                     │
│ [P] [P] [P] [P]       │ VAT                          │
│                       │ Charges                      │
│                       │ GRAND TOTAL                  │
│                       │ Cash/Card/Other/Due          │
│                       │ COMPLETE SALE                │
└───────────────────────┴──────────────────────────────┘
```

Suggested shortcuts:

```text
F2 Search
F4 Customer
F6 Hold
F8 Payment
F9 Discount
F10 Complete
Esc Close
Ctrl+Enter Confirm
```

---

# 10. SALES FLOW

```text
Cart
→ Product validation
→ Customer
→ Stock validation
→ Discount
→ VAT
→ Charges
→ Payment
→ Server recalculation
→ DB transaction
   ├─ Sale
   ├─ Sale Items
   ├─ Stock Decrease
   ├─ Stock Ledger
   ├─ Payment
   ├─ Customer Ledger
   ├─ Accounting Journal
   └─ Audit
→ Commit
→ Invoice
```

Client totals are never authoritative.

---

# 11. PURCHASE FLOW

```text
Purchase
→ Supplier
→ Branch/Warehouse
→ Items
→ Cost calculation
→ Discount/VAT/Charges
→ Payment
→ Transaction
   ├─ Purchase
   ├─ Items
   ├─ Stock Increase
   ├─ Stock Ledger
   ├─ Supplier Ledger
   ├─ Payment
   ├─ Accounting
   └─ Audit
→ Commit
```

---

# 12. PRODUCT SYSTEM

Product fields:

```text
id
organizationId
sku
name
slug
description
brandId
categoryId
unitId
purchasePrice
sellingPrice
wholesalePrice
minimumPrice
vatType
vatValue
trackStock
trackExpiry
trackBatch
trackSerial
reorderLevel
warrantyAvailable
status
createdAt
updatedAt
deletedAt
```

Reference product form visibly includes product title, brand, category, unit type, purchase price, selling price, image, SKU, discount type, VAT status, IT status, warranty, alert quantity, description and barcode.

---

# 13. VARIATIONS

Support variation heads/items:

```text
Color
 ├─ Black
 ├─ Red
 └─ Blue

Size
 ├─ S
 ├─ M
 └─ L
```

Each variant can have:

- SKU
- Barcode
- Price
- Stock
- Image
- MFG date
- EXP date
- Weight

---

# 14. PRODUCT IMPORT

Reference visibly supports CSV upload.

Flow:

```text
Upload CSV
→ Header validation
→ Parse
→ Preview
→ Row validation
→ Confirm
→ Batch process
→ Import summary
→ Error report
```

Summary:

```text
Total
Success
Failed
Skipped
```

---

# 15. INVENTORY

Use two core concepts:

```text
stock_balances
stock_ledgers
```

Movement types:

```text
OPENING
PURCHASE
SALE
CUSTOMER_RETURN
SUPPLIER_RETURN
TRANSFER_IN
TRANSFER_OUT
DAMAGE
EXPIRY
ADJUSTMENT
OWN_STOCK
```

Formula:

```text
Current Stock =
Opening
+ Purchase
+ Customer Return
+ Transfer In
+ Own Stock
+ Positive Adjustment
- Sale
- Supplier Return
- Transfer Out
- Damage
- Expiry
- Negative Adjustment
```

Every movement must be traceable.

---

# 16. PRODUCT STOCK

Support filters:

```text
Branch
Warehouse
Brand
Category
Product
Barcode
Status
Rack
Expiry
```

Reference visibly shows product stock with price, current stock, lot, rack and expiry information.

---

# 17. STOCK SUMMARY

Reference visibly shows aggregate fields such as:

```text
Purchase Price
Sale Price
Stock In
Stock Out
Return
Current Stock
Purchase Value
Sale Value
```

Implement with SQL aggregation rather than loading all rows into the browser.

---

# 18. STOCK ALERT

Statuses:

```text
NORMAL
LOW
OUT_OF_STOCK
```

Use:

```text
reorderLevel
currentStock
```

Server-side filters should include generic/category/brand/branch where configured.

---

# 19. EXPIRED PRODUCTS

Support:

```text
Product
Barcode
Brand
Category
Generic
Branch
Lot
Stock
Manufacture Date
Expiry Date
Status
```

Expiry status should be calculated from dates, not only a manual flag.

---

# 20. OPENING STOCK + OWN STOCK

Reference visibly contains:

```text
Opening Stock
Set Bulk Opening Stock
Opening Stock Invoices
Own Stock Invoices
```

Opening stock:

```text
Location
Product
Quantity
Value
MFG Date
EXP Date
Rack
→ Opening Stock Invoice
→ Stock Ledger
```

Bulk opening stock supports CSV.

Own stock should have its own document type and stock ledger event.

---

# 21. PRODUCT TRANSFER

Reference visibly contains:

```text
Create Transfer
Stock Transfer
Transferred Histories
```

Fields:

```text
Sender
Receiver
Products
Quantity
Note
Status
```

Flow:

```text
Draft
→ Pending Approval
→ Approved
→ Transferred
→ Received
```

Transaction:

```text
TRANSFER_OUT sender
+
TRANSFER_IN receiver
```

---

# 22. DAMAGE

Reference visibly shows:

```text
All Damaged Products
Add Damage Product
```

Fields:

```text
Date
Place
Product
Lot
Purchase Price
Sale Price
Discount
VAT
Quantity
Reason
User
```

Damage must decrease stock and create a stock ledger event.

---

# 23. RACK MANAGEMENT

```text
Warehouse
 └─ Rack
     └─ Product Stock
```

Support:

- Rack CRUD
- Product assignment
- Location filtering

---

# 24. CUSTOMERS

Reference:

```text
Customer Types
Add New Customer
All Customers
Installment Reminders
Loyalty Tiers
Loyalty Cards
Take Customer Due
Customer Advance
Sold Invoices
```

Customer:

```text
name
phone
email
address
customerType
openingBalance
creditLimit
paymentTerms
status
```

---

# 25. CUSTOMER LEDGER

```text
Balance =
Opening
+ Credit Sales
- Payments
- Returns
+ Adjustments
```

Ledger remains the source of truth.

---

# 26. CUSTOMER DUE

Flow:

```text
Customer
→ Outstanding Due
→ Invoice/Due Selection
→ Payment Method
→ Amount
→ Customer Ledger
→ Payment
→ Accounting
→ Receipt
→ Optional SMS
```

---

# 27. CUSTOMER ADVANCE

```text
Customer
→ Advance
→ Payment Method
→ Advance Record
→ Customer Ledger
→ Cash/Bank
→ Accounting
```

Advance must remain distinguishable from normal due collection.

---

# 28. INSTALLMENTS

Reference visibly shows installment reminders.

Support:

```text
Upcoming installments
Overdue installments
Customer
Invoice
Amount
Due Date
Status
Reminder action
```

---

# 29. LOYALTY

Reference visibly shows tiers and cards.

Tier fields:

```text
Tier Name
Minimum Spend
Discount %
Benefits / Note
Status
```

Card:

```text
Card Number
Customer
Type
Tier
Status
Issued
Expires
```

Use a transaction ledger:

```text
EARN
REDEEM
EXPIRE
ADJUST
REVERSAL
```

---

# 30. SUPPLIERS

Supplier:

```text
name
phone
email
address
openingPayable
creditLimit
paymentTerms
status
```

Supplier ledger:

```text
Opening
+ Credit Purchases
- Payments
- Returns
+ Adjustments
```

---

# 31. ACCOUNTING

Reference visibly includes:

```text
Bank & Cash
Transaction
Expenses
Direct / Indirect Income
Vouchers
Assets
Liabilities
Loan & Capital
Reports
Account Statement
```

Implement double-entry accounting.

Invariant:

```text
TOTAL DEBIT = TOTAL CREDIT
```

---

# 32. CHART OF ACCOUNTS

Suggested:

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

Make chart configurable.

---

# 33. ACCOUNTING ENTRIES

Sale:

```text
Dr Cash / Accounts Receivable
Cr Sales Revenue

Dr COGS
Cr Inventory
```

Customer payment:

```text
Dr Cash/Bank
Cr Accounts Receivable
```

Purchase:

```text
Dr Inventory
Cr Accounts Payable
```

Supplier payment:

```text
Dr Accounts Payable
Cr Cash/Bank
```

Expense:

```text
Dr Expense
Cr Cash/Bank
```

All source modules must use a centralized accounting service.

---

# 34. BANK & CASH

Bank fields:

```text
Bank Name
Account Number
Account Type
Branch
Balance
```

Support:

- Opening balance
- Deposit
- Withdrawal
- Transfer
- Statement

Cash supports:

- Opening
- Cash In
- Cash Out
- Sales
- Refund
- Expense
- Transfer
- Closing

---

# 35. TRANSACTION HISTORY

Reference visibly shows:

```text
From Date
To Date
Filter By Head
Date
Type
Cash/Bank
Amount
CR/DR
Reference
Added By
```

Use server-side filters and pagination.

---

# 36. TRANSACTION REGISTRY

Reference visibly contains transaction types such as:

```text
Supplier Due Payment
Contra / Balance Transfer
Dealer Collection
Supplier Instant Payment
Supplier Return Refund
Loan Paid
Loan Received
Capital Added
Capital Withdraw
Expense Payment
Customer Product Return
Sell
Indirect Income
Other Income
Liability Received
Liability Payment
Fixed Asset Purchase
Customer Due Received
```

Represent these using typed enums/constants, not random magic strings.

---

# 37. EXPENSE / INCOME / VOUCHER

Expense:

```text
Date
Account
Amount
Payment Method
Branch
Note
Attachment
```

Income:

```text
Category
Amount
Payment Method
Branch
Reference
Note
```

Voucher types:

```text
Payment
Receipt
Journal
Contra
```

---

# 38. ASSETS / LIABILITIES / LOANS / CAPITAL

Assets:

```text
Asset
Category
Purchase Date
Value
Branch
Status
```

Liabilities:

```text
Liability
Received
Paid
Balance
```

Loans:

```text
Lender
Amount
Received
Paid
Balance
```

Capital:

```text
Capital Added
Capital Withdrawn
Owner
Reference
```

---

# 39. ACCOUNT STATEMENT

Support:

```text
Account
Date Range
Opening Balance
Debit
Credit
Running Balance
Reference
```

---

# 40. SHIFT MANAGEMENT

Lifecycle:

```text
OPEN
→ ACTIVE
→ CLOSING
→ CLOSED
```

Track:

```text
Opening Cash
Cash Sales
Cash In
Cash Out
Refunds
Expected Cash
Actual Cash
Difference
```

Cannot close a shift twice.

---

# 41. SMS

Reference visibly includes:

```text
SMS Dashboard
Bill SMS Format
Due Collection SMS Format
SMS Settings
SMS Histories
Send SMS
Recharge Requests
```

Dashboard:

```text
Current SMS Quantity
Per SMS Price
Total Purchase
Today Sent
Month Sent
Year Sent
Total Sent
Balance
```

Templates use approved variables such as:

```text
customer_name
customer_wallet_point
previous_due
todays_bill
total_bill
todays_paid
invoice_number
current_balance
shop_name
paid_amount
due_amount
```

Never execute arbitrary code in templates.

---

# 42. CRM

Reference visibly shows CRM user/role style records.

Create:

```text
CRM contacts
CRM activities
Assignments
Segments
Follow-ups
Marketing status
```

Keep CRM modular.

---

# 43. API

Use:

```text
/api/v1/
```

Examples:

```text
GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/:id
PATCH  /api/v1/products/:id

POST   /api/v1/sales
GET    /api/v1/sales
GET    /api/v1/sales/:id
POST   /api/v1/sales/:id/cancel
POST   /api/v1/sales/:id/return

GET    /api/v1/inventory/stock
GET    /api/v1/inventory/ledger
POST   /api/v1/inventory/adjustments
POST   /api/v1/inventory/transfers

GET    /api/v1/customers
POST   /api/v1/customers
POST   /api/v1/customers/:id/payment
POST   /api/v1/customers/:id/advance
```

Response:

```json
{
  "success": true,
  "data": {},
  "message": "Operation completed",
  "meta": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "fields": {}
  }
}
```

Never expose raw database errors.

---

# 44. DATABASE

Core tables:

```text
organizations
branches
warehouses
racks

users
roles
permissions
role_permissions
user_roles
user_branch_access
sessions
password_resets

products
product_variants
product_images
product_barcodes
brands
categories
units
product_prices

stock_balances
stock_ledgers
stock_transfers
stock_transfer_items
stock_adjustments
damage_records
expiry_batches
opening_stocks
own_stock_invoices

sales
sale_items
sale_payments
sale_returns
sale_return_items
invoices
held_tickets

purchases
purchase_items
purchase_payments
purchase_returns
purchase_return_items

customers
customer_types
customer_addresses
customer_ledgers
customer_payments
customer_advances
installments

suppliers
supplier_ledgers
supplier_payments

loyalty_tiers
loyalty_cards
loyalty_transactions

account_groups
accounts
journals
journal_entries
journal_lines
vouchers
expenses
income
assets
liabilities
loans
capital_transactions
cash_accounts
bank_accounts
bank_transactions

shifts
cash_movements
cash_handovers

sms_templates
sms_messages
sms_logs
sms_recharge_requests

crm_contacts
crm_activities
crm_assignments
crm_segments

settings
file_assets
imports
import_rows
audit_logs
api_logs
notification_logs
```

Common fields:

```text
id
organizationId
createdAt
updatedAt
```

Where needed:

```text
branchId
warehouseId
createdBy
updatedBy
deletedAt
```

Use foreign keys, unique constraints and indexes.

Money:

```text
DECIMAL(18,2)
```

Fractional quantity:

```text
DECIMAL(18,4)
```

---

# 45. DOCUMENT NUMBERING

Examples:

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

Generation must be transaction-safe.

---

# 46. TRANSACTION + IDEMPOTENCY

Atomic operations:

- Sale
- Purchase
- Return
- Payment
- Advance
- Transfer
- Adjustment
- Opening stock
- Own stock
- Loyalty redemption
- Shift close
- Accounting posting

Sensitive/external endpoints should support:

```text
Idempotency-Key: UUID
```

This prevents duplicate operations after retries/double clicks.

---

# 47. SECURITY

Protect against:

```text
SQL Injection
XSS
CSRF
IDOR
Privilege Escalation
Cross-Tenant Access
Cross-Branch Access
Brute Force
Credential Stuffing
Session Theft
Replay
Duplicate Transactions
Malicious Uploads
Path Traversal
Secret Leakage
```

Headers to review:

```text
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
Strict-Transport-Security
Frame protection
```

Cookies:

```text
HttpOnly
Secure
SameSite
appropriate expiry
```

Uploads:

```text
Extension validation
MIME validation
Size validation
File signature validation where appropriate
Generated filenames
Non-executable storage
```

---

# 48. AUDIT

Critical actions:

```text
Login
Failed Login
Create
Update
Delete
Sale
Purchase
Return
Payment
Transfer
Stock Adjustment
Accounting Post
Accounting Reverse
Role Change
Permission Change
Settings Change
Import
Export
```

Audit fields:

```text
organizationId
branchId
userId
action
module
entityType
entityId
before
after
ip
userAgent
createdAt
```

Never log passwords, session tokens or API secrets.

---

# 49. DSA

Cart:

```text
Map<VariantId, CartItem>
```

Expected average lookup/update:

```text
O(1)
```

Permissions:

```text
Set<Permission>
```

Product search:

```text
Indexed database query
```

Pagination:

```text
Offset for ordinary admin screens
Cursor for high-volume ledger/report screens where appropriate
```

Do not scan huge datasets in the browser.

---

# 50. FOLDER STRUCTURE

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
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── config/
└── tests/
```

---

# 51. ROUTE MAP

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

---

# 52. PHASE PLAN

```text
PHASE 00 Architecture Freeze
PHASE 01 UI/UX Foundation
PHASE 02 Complete UI
PHASE 03 Database
PHASE 04 Auth + RBAC
PHASE 05 Products + Inventory
PHASE 06 Purchase + Supplier
PHASE 07 POS + Sales
PHASE 08 Returns + Refunds
PHASE 09 Accounting
PHASE 10 Customer + CRM + Loyalty
PHASE 11 Quotation + Requisition
PHASE 12 Shift + Cash
PHASE 13 SMS + Notifications
PHASE 14 Reports
PHASE 15 Import + Export + Print
PHASE 16 Security Hardening
PHASE 17 Performance
PHASE 18 Full QA
PHASE 19 cPanel Deployment
PHASE 20 Production Verification
```

---

# 53. PHASE 00

Freeze:

- Modules
- Routes
- Entities
- Permissions
- Business rules
- Accounting rules
- Stock rules
- Numbering
- Branch rules

Documents:

```text
/docs/PRD.md
/docs/ARCHITECTURE.md
/docs/DATABASE.md
/docs/API.md
/docs/PERMISSIONS.md
/docs/BUSINESS_RULES.md
/docs/SECURITY.md
/docs/TEST_PLAN.md
```

---

# 54. PHASE 01

Build the complete design system and application shell.

Mock data only.

Acceptance:

```text
typecheck PASS
lint PASS
build PASS
no console errors
```

---

# 55. PHASE 02

Build all planned routes with realistic mock data.

Every page must have:

```text
Header
Breadcrumb
Primary CTA
Search/Filter
Content
Loading
Empty
Error
Responsive UI
```

No real backend mutation.

---

# 56. PHASE 03

Implement Prisma/MySQL:

- Organizations
- Branches
- Warehouses
- Racks
- Users
- Roles
- Permissions
- Products
- Customers
- Suppliers
- Accounts
- Audit

Create migrations and seed.

---

# 57. PHASE 04

Implement:

- Login
- Logout
- Sessions
- Password reset
- Users
- Roles
- Permissions
- Branch access
- Tenant isolation
- Audit

Test:

```text
Wrong password
Unauthorized route
Unauthorized API
Wrong organization
Wrong branch
Insufficient permission
```

---

# 58. PHASE 05

Implement:

- Products
- Brands
- Categories
- Units
- Variants
- Barcodes
- Opening stock
- Own stock
- Stock ledger
- Stock balance
- Adjustments
- Damage
- Expiry
- Transfers
- Alerts
- Summary

Test stock concurrency and insufficient stock.

---

# 59. PHASE 06

Implement Purchase + Supplier.

Every purchase must atomically update:

```text
Purchase
Items
Stock
Stock Ledger
Supplier Ledger
Payment
Accounting
Audit
```

---

# 60. PHASE 07

Implement POS + Sales.

Every sale must atomically update:

```text
Sale
Items
Stock
Stock Ledger
Payment
Customer Ledger
Accounting
Audit
```

Server recalculates all totals.

---

# 61. PHASE 08

Implement customer/supplier returns and refunds.

Rules:

```text
returnedQty <= eligibleQty
```

Prevent duplicate/over returns.

---

# 62. PHASE 09

Implement double-entry accounting.

Invariant:

```text
SUM(debit) = SUM(credit)
```

Posted records are corrected through reversal/adjustment, not silent edits.

---

# 63. PHASE 10

Implement:

- Customer types
- Customer profile
- Due
- Advance
- Installment
- CRM
- Loyalty tiers
- Loyalty cards
- Loyalty transactions

---

# 64. PHASE 11

Implement:

Quotation:

```text
Draft → Sent → Accepted → Converted
```

Requisition:

```text
Requested → Approval → Approved/Rejected → Fulfilled
```

---

# 65. PHASE 12

Implement:

- Open shift
- Opening cash
- Cash in/out
- Expected cash
- Actual cash
- Difference
- Close
- Handover

Cannot close twice.

---

# 66. PHASE 13

Implement:

- SMS provider
- Templates
- Dynamic variables
- Send
- History
- Settings
- Recharge
- Notification logs
- Retry

Provider failure must not corrupt financial transactions.

---

# 67. PHASE 14

Implement server-side reports:

```text
Sales
Purchase
Inventory
Product
Customer
Supplier
Cash
Bank
Expense
Income
P&L
Trial Balance
Day Book
Account Statement
Branch
Loyalty
SMS
```

Use SQL aggregation.

---

# 68. PHASE 15

Implement:

```text
CSV Import
CSV Export
XLSX where needed
A4 Invoice
Thermal Receipt
Barcode Labels
Barcode Report
Quotation Print
Voucher Print
```

---

# 69. PHASE 16

Security audit:

```text
Auth
RBAC
Tenant Isolation
Branch Isolation
IDOR
SQL Injection
XSS
CSRF
Rate Limiting
File Upload
Session
Cookies
Headers
Error Leakage
Secrets
Audit
```

---

# 70. PHASE 17

Performance:

```text
Bundle
Server/Client boundaries
Database indexes
N+1
Slow reports
Search
POS
Tables
Images
API latency
```

Use SQL `EXPLAIN` for expensive queries.

---

# 71. PHASE 18

Testing:

## Unit

```text
Money
Discount
VAT
Stock
Ledger
Permissions
Number generation
```

## Integration

```text
Sale
Purchase
Return
Payment
Transfer
Accounting
```

## E2E

```text
Login
→ Sale
→ Payment
→ Invoice
→ Verify stock
→ Verify customer
→ Verify accounting
→ Verify audit
```

---

# 72. PHASE 19 — CPANEL

Target:

```text
cPanel
Node.js Application
MySQL
SSL
Environment Variables
Cron
SMTP
```

Deployment:

```text
Git
→ Install
→ Build
→ Environment
→ Prisma migration
→ Health check
→ Smoke test
```

Never commit `.env` or production secrets.

---

# 73. PHASE 20 — PRODUCTION VERIFICATION

Verify:

```text
HTTPS
Login
RBAC
Dashboard
POS
Sale
Purchase
Inventory
Customer
Supplier
Accounting
Reports
Print
Upload
SMS/Email
Cron
Health
Database
Backup
```

Do not perform destructive tests on production.

---

# 74. CPANEL ENVIRONMENT

```env
NODE_ENV=production

DATABASE_URL=

APP_URL=
AUTH_SECRET=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

SMS_PROVIDER=
SMS_API_KEY=

STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_BUCKET=
```

---

# 75. HEALTH CHECK

Create:

```text
GET /api/health
```

Example:

```json
{
  "status": "ok",
  "database": "ok",
  "version": "1.0.0"
}
```

Never expose secrets.

---

# 76. BACKUP

Minimum:

```text
Daily DB backup
Off-server copy
Retention policy
Restore test
```

A backup is only trusted after a restore test.

---

# 77. OBSERVABILITY

Log:

```text
API errors
Auth failures
Slow requests
Slow DB queries
Failed jobs
SMS failures
Email failures
Import failures
Export failures
External API failures
```

Use structured logging.

---

# 78. CURSOR MASTER SYSTEM PROMPT

Paste this permanently into the Cursor project instructions:

```text
You are the principal software architect and senior full-stack engineer responsible for a production-grade POS, inventory, accounting, CRM and business-management platform.

STACK:
Next.js, TypeScript, MySQL, Prisma, Tailwind CSS, React Hook Form, Zod.

ARCHITECTURE:
Modular monolith.
UI → API → Application → Domain → Infrastructure.
Multi-tenant organization scope.
Branch-aware authorization.
RBAC.
Centralized business rules.
Centralized accounting.
Ledger-based inventory.

STRICT RULES:
1. Never put business logic inside JSX.
2. Never call Prisma directly from UI components.
3. Never duplicate calculations.
4. Never trust client organizationId.
5. Never trust client branchId.
6. Never trust client totals.
7. Never trust client stock.
8. Never expose secrets.
9. Never store plaintext passwords.
10. Never use floating point as financial authority.
11. Never mutate stock without ledger history.
12. Never post an unbalanced journal.
13. Never perform financial mutations without transaction protection.
14. Never bypass server authorization.
15. Never disable TypeScript to hide errors.
16. Never disable lint to hide errors.
17. Never delete tests to hide failures.
18. Never create fake production APIs.
19. Never add unnecessary dependencies.
20. Never refactor unrelated code without justification.

PROCESS:
1. Inspect repository.
2. Understand architecture.
3. Identify reusable code.
4. Identify affected modules.
5. Identify risks.
6. Make implementation plan.
7. Implement only requested phase.
8. Run typecheck.
9. Run lint.
10. Run tests.
11. Run production build.
12. Fix root causes.
13. Report files changed.
14. Report verification.
15. Stop.

SECURITY:
Authenticate protected requests.
Authorize every mutation.
Verify organization ownership.
Verify branch access.
Validate all input.
Protect files.
Rate-limit sensitive operations.
Audit critical actions.

FINANCIAL:
Central calculation engine.
Server recalculates totals.
Double-entry accounting.
Debit equals credit.
Posted entries cannot be silently edited.
Use reversal/adjustment.

INVENTORY:
Transaction-safe.
Ledger-based.
Race-condition protected.
Validate stock inside transaction.

UI:
Premium SaaS quality.
Responsive.
Accessible.
Keyboard-friendly POS.
Consistent design system.
Loading/empty/error/unauthorized states.

CODE:
Strict TypeScript.
Small cohesive functions.
Clear names.
No dead code.
No unnecessary duplication.
```

---

# 79. CURSOR PHASE PROMPT TEMPLATE

```text
PHASE:
[NUMBER + NAME]

OBJECTIVE:
[Exact objective]

IN SCOPE:
[List]

OUT OF SCOPE:
[List]

DEPENDENCIES:
[List]

UI REQUIREMENTS:
[List]

DATABASE REQUIREMENTS:
[List]

API REQUIREMENTS:
[List]

BUSINESS RULES:
[List]

SECURITY REQUIREMENTS:
[List]

TEST REQUIREMENTS:
[List]

ACCEPTANCE CRITERIA:
[List]

Before coding:
- Inspect repository
- Inspect related DB models
- Inspect services
- Inspect permissions
- Identify reusable components

After coding:
- Typecheck
- Lint
- Tests
- Build

Do not continue beyond this phase.
```

---

# 80. DEFINITION OF DONE

A module is complete only when:

```text
[ ] UI
[ ] API
[ ] Validation
[ ] Authorization
[ ] Tenant scope
[ ] Branch scope where needed
[ ] DB constraints
[ ] Business rules
[ ] Transactions
[ ] Audit
[ ] Error handling
[ ] Loading state
[ ] Empty state
[ ] Permission state
[ ] Tests
[ ] Typecheck PASS
[ ] Lint PASS
[ ] Build PASS
[ ] Security review
```

---

# 81. RECONCILIATION TESTS

The system must be able to verify:

```text
Sales total = sales records
Customer balance = customer ledger
Supplier payable = supplier ledger
Inventory balance = reconstructed stock ledger
Trial balance debit = credit
```

---

# 82. GIT WORKFLOW

```text
main
develop
feature/*
fix/*
hotfix/*
```

Commit examples:

```text
feat(products): add product variants
feat(sales): implement transactional sale
fix(inventory): prevent negative stock race
test(accounting): add journal balance tests
security(auth): add login rate limiting
```

---

# 83. RELEASE CHECKLIST

```text
[ ] Backup
[ ] Migration reviewed
[ ] Typecheck
[ ] Lint
[ ] Tests
[ ] Build
[ ] Security review
[ ] Environment variables
[ ] Health check
[ ] Smoke test
[ ] Rollback plan
```

---

# 84. FINAL QUALITY STANDARD

```text
Professional UI
+
Clean Architecture
+
MySQL Integrity
+
Prisma Data Layer
+
Transactional Business Logic
+
Double-Entry Accounting
+
Ledger-Based Inventory
+
RBAC
+
Tenant Isolation
+
Branch Isolation
+
Auditability
+
Testing
+
Security
+
Performance
+
Reliable cPanel Deployment
=
PRODUCTION-GRADE POS / ERP PLATFORM
```

The application is NOT considered complete merely because all screens exist.

It is complete only when the UI, API, database, business rules, transactions, accounting, inventory, security, audit, tests and deployment all work consistently.

---

# 85. FINAL CURSOR EXECUTION RULE

Cursor must execute exactly one phase at a time.

At the end of each phase report:

```text
PHASE STATUS

Implemented:
- ...

Files Changed:
- ...

Database Changes:
- ...

API Changes:
- ...

Business Logic Changes:
- ...

Security Changes:
- ...

Tests Added:
- ...

Verification:
- Typecheck: PASS/FAIL
- Lint: PASS/FAIL
- Tests: PASS/FAIL
- Build: PASS/FAIL

Known Issues:
- ...

Next Phase:
- ...
```

If any required verification fails:

```text
STOP.
DO NOT START THE NEXT PHASE.
FIX THE ROOT CAUSE FIRST.
```

---

# 86. MASTER DEVELOPMENT ORDER

```text
ARCHITECTURE
↓
UI DESIGN SYSTEM
↓
ALL UI ROUTES
↓
DATABASE
↓
AUTH
↓
RBAC
↓
PRODUCTS
↓
INVENTORY
↓
PURCHASE
↓
SUPPLIER
↓
POS
↓
SALES
↓
RETURNS
↓
ACCOUNTING
↓
CUSTOMER
↓
CRM
↓
LOYALTY
↓
QUOTATION
↓
REQUISITION
↓
SHIFT
↓
SMS
↓
REPORTS
↓
IMPORT / EXPORT
↓
PRINT
↓
SECURITY
↓
PERFORMANCE
↓
QA
↓
CPANEL
↓
PRODUCTION
```

# END OF MASTER BLUEPRINT
