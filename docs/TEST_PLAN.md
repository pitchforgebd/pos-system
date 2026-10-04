# Test Plan

**Status:** Frozen scope  
**Phase:** 00 — Architecture Freeze

Phase 00 has no application, so typecheck, lint, unit tests, and build do not run. They become mandatory at the end of every later phase that has a `package.json`.

If a later phase's required check fails, that phase stays open. The next phase does not start.

## 1. Levels

| Level | Covers |
| --- | --- |
| Unit | Money, discount, VAT once defined, stock formula, customer and supplier balances, permission set checks, document numbers, journal balance |
| Integration | Database plus services for sale, purchase, return, payment, transfer, accounting |
| API | Authentication, authorization, validation, tenant and branch rejection |
| E2E | Critical workflows below |
| Reconciliation | Inventory, journals, customer, supplier |

## 2. Critical workflows

Minimum end-to-end coverage before production verification:

```text
Login
Create product
Create customer
Create supplier
Purchase
Stock increase
Sale
Stock decrease
Customer due
Due collection
Purchase return
Sales return
Stock transfer
Expense
Income
Bank transfer
Shift open
Shift close
```

POS path, once Phase 07 and 09 exist:

```text
Login
→ Sale
→ Payment
→ Invoice
→ Stock matches the ledger
→ Customer balance matches the ledger
→ Journal debit equals credit
→ Audit row exists
```

## 3. Phase 04 authorization cases

```text
Wrong password
Unauthenticated page
Unauthenticated API
Wrong organization
Wrong branch
Missing permission
Disabled user
```

## 4. Reconciliation

These queries or tests must be able to run against the database after the related phase.

**Inventory**

```text
Opening
+ Purchase
+ Customer return
+ Transfer in
+ Own stock
+ Positive adjustment
− Sale
− Supplier return
− Transfer out
− Damage
− Expiry
− Negative adjustment
= stock_balances.quantity
```

**Accounting**

```text
For each posted journal: sum(debit) = sum(credit)
Trial balance debit = trial balance credit
```

**Customer**

```text
Opening
+ Credit sales
− Payments
− Returns
+ Adjustments
= outstanding balance from customer_ledgers
```

**Supplier**

```text
Opening payable
+ Credit purchases
− Payments
− Returns
+ Adjustments
= outstanding payable from supplier_ledgers
```

**Other identities**

```text
Sales report total = sum of sales records in the same filter
```

## 5. Failure and concurrency

- Insufficient stock inside the sale transaction (exact policy waits on the open decision in `docs/BUSINESS_RULES.md`)
- Two concurrent sales of the last unit: one commits, one fails, stock is not negative unless a written rule allows it
- Idempotency replay returns the original document and does not post twice
- Same idempotency key with a different body returns conflict
- Accounting failure rolls back the sale or purchase
- Return above eligible quantity is rejected
- Shift close is rejected the second time
- Import reports failed rows and does not mark them successful

## 6. UI states

From Phase 02 onward, each screen is checked for header, breadcrumb, primary action, search or filter, content, loading, empty, error, and a narrow viewport. Phase 01 checks the shell, tokens, and core components on a desktop width and a mobile width.

## 7. Security regression

Phase 16 executes `docs/SECURITY.md` section 8 against the real routes. A control is not marked done from inspection alone when a request can probe it.

## 8. Commands once the app exists

Use the scripts in `package.json`. The expected set is:

```text
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

If a script name differs, the phase report uses the name that exists and says so.

## 9. Production

Phase 20 checks HTTPS, login, RBAC, dashboard, POS, sale, purchase, inventory, customer, supplier, accounting, reports, print, upload, SMS or email, cron, health, database, and backup status. No destructive test on production data.

Checked on the local production server (`next start`), not on a public host. Login, the owner screens, and `/users` returned 200. `/branches` returned 403. Health returned database ok and no connection string. HSTS is absent on HTTP and present when `APP_URL` is HTTPS. Print, product import, SMS send, and forgot-password opened. No sale, purchase, stock, or mail was posted. The backup script wrote a dump outside the web root, restored it into `meridian_p20_restore` (95 tables), then dropped that database and the dump. The live `meridian` database stayed in place. SMTP is still not sent.

## 10. Phase 00 acceptance

```text
[x] Modules frozen in docs/ARCHITECTURE.md
[x] Routes frozen in docs/ARCHITECTURE.md
[x] Entities frozen in docs/DATABASE.md
[x] Permissions frozen in docs/PERMISSIONS.md
[x] Business, accounting, stock, numbering, and branch rules written
[x] Open rules explicitly not invented
[x] Security requirements written
[x] Test plan written
[ ] Application typecheck — not applicable, no application
[ ] Lint — not applicable
[ ] Build — not applicable
```

## 11. Phase 18

The suite in `src/modules/qa/qa.test.ts` runs the checks that were still split across phases:

- Money accepts two decimals and rejects a third. Quantity rejects zero. A half-up remainder becomes the next cent.
- Discount and VAT on a sale line are rejected. A stock transfer is still rejected.
- The next two invoice numbers on one organization are `INV-2026-000001` and `INV-2026-000002`.
- A cashier without `users.view` cannot open users. The register stays open with `sales.view`.
- One path signs in, posts a sale with a cash payment and a due, collects part of that due, and checks the invoice number, the remaining stock, the ledger match, the customer outstanding, balanced journals, and the login, sale, and payment audit rows.
- Two sales of the last unit leave quantity zero. One sale is posted and the other is rejected.

Income is still not posted, because the debit and credit accounts are not defined. Browser clicks are not part of this suite.
