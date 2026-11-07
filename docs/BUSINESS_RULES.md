# Business Rules

> v2 কাজের জন্য `docs/meridian-v2/v2/` দেখুন; সংঘাতে v2 জিতবে। (For v2 work see `docs/meridian-v2/v2/`; where they conflict, v2 wins.)

**Status:** Frozen where the blueprint states a rule. Open where it does not.  
**Phase:** 00 — Architecture Freeze

Financial, tax, payment, and inventory behavior that the blueprint does not define is listed under open decisions. It is not implemented by guessing.

## 1. Scope

- Organization comes from the session.
- Branch comes from the session grants.
- Client totals, stock figures, and prices are inputs to check, not results to store.
- The server recalculates line amounts, discounts, VAT, charges, and totals inside the transaction.
- Money uses decimal arithmetic with scale 2. Quantities use scale 4.
- A failed accounting or stock step rolls back the business document. Partial financial rows must not remain.

## 2. Inventory

Current stock for a product, variant, branch, and warehouse:

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
= Current stock
```

Every change writes `stock_ledgers` and updates `stock_balances` in the same database transaction.

Phase 05 rejects an outbound movement that would make `stock_balances.quantity` negative. No override setting is defined, so none is implemented. The generic filter reads category; no generic column was added. Opening-stock and own-stock lines are the ledger rows for that invoice. The blueprint's opening Value is stored as `stock_ledgers.unitCost` and is not posted to an inventory account. Rack is named on the opening-stock form and is not a column on `opening_stocks`, so it is not stored. CSV bulk opening stock remains the Phase 15 import flow. Transfers follow section 8.

| Event | Direction |
| --- | --- |
| Opening stock | IN, type `OPENING` |
| Purchase | IN, type `PURCHASE` |
| Sale | OUT, type `SALE` |
| Customer return | IN, type `CUSTOMER_RETURN` |
| Supplier return | OUT, type `SUPPLIER_RETURN` |
| Transfer | OUT `TRANSFER_OUT` at source and IN `TRANSFER_IN` at destination, subject to section 8 |
| Damage | OUT, type `DAMAGE` |
| Expiry write-off | OUT, type `EXPIRY` |
| Adjustment | IN or OUT, type `ADJUSTMENT` |
| Own stock | IN, type `OWN_STOCK`, own document type |

Ledger columns: product, variant, branch, warehouse when used, quantity, direction, movement type, reference type, reference id, user, timestamp, unit cost when the operation has one.

Stock alert status:

```text
NORMAL       currentStock > reorderLevel
LOW          0 < currentStock <= reorderLevel
OUT_OF_STOCK currentStock = 0
```

Expiry status is computed from expiry dates, not from a manual flag alone. Filters include product, barcode, brand, category, generic, branch, lot, stock, manufacture date, expiry date, and status. "Generic" is named by the blueprint and has no column yet. Phase 05 must map it to category or add a field only after this document is updated.

Opening stock creates an opening-stock invoice, a ledger row, and a balance change. Bulk opening stock is CSV through the import flow. Own stock uses its own invoice and `OWN_STOCK`.

Damage fields: date, place, product, lot, purchase price, sale price, discount, VAT, quantity, reason, user. Damage reduces stock.

Returned quantity cannot exceed the quantity still eligible on the source document. A second return cannot consume the same units.

## 3. Sales

```text
Cart
→ Validate products
→ Customer
→ Validate stock
→ Discount
→ VAT
→ Charges
→ Payment
→ Server recalculation
→ Transaction
   sale, sale items, stock decrease, stock ledger,
   payment, customer ledger, accounting journal, audit
→ Commit
→ Invoice
```

Held tickets do not move stock and do not post journals.

POS input: product search, barcode, category filter, cart keyed by variant id, quantity, discount, VAT, customer, cash, card, other, due. Shortcuts are F2 search, F4 customer, F6 hold, F8 payment, F9 discount, F10 complete, Esc close, Ctrl+Enter confirm.

Phase 07 calculates each line as quantity times the product selling price, rounded half-up to scale 2. The sale total is the sum of those line totals. A client unit price that differs from the selling price is rejected. `sales.price_override` stays unused until section 16 defines limits. Variant price, wholesale price, and `product_prices` rows are not selected. Header and line discount, VAT, and charges stay zero; a sale that needs a non-zero discount, VAT, or charge is rejected. `sales.discount` stays unused until stacking rules exist.

The paid amount uses cash (account 1100), bank (account 1200), or card (account 1200) and cannot exceed the total. The unpaid amount is the due. Other tenders stay rejected because they have no chart account. A line discount cannot exceed the line. Product VAT is exclusive when `vatType` is EXCLUSIVE or PERCENT, and included in the price when `vatType` is INCLUSIVE. VAT credits 2300. Other charges credit 4200. A price below the minimum is rejected. A different unit price is accepted only when the account holds `sales.price_override`. Cost of goods uses the moving-average unit cost of the stock on hand for that product, variant, branch, and warehouse (see the cost rule below). A sale is not rejected for a missing cost. The sale journal is one posted journal: Dr 1100 Cash for the paid amount, Dr 1300 Accounts Receivable for the due, Cr 4100 Sales for the total, plus Dr 5100 COGS and Cr 1400 Inventory for the cost below. Lines of zero are omitted. A due amount requires an active customer. When that customer has a credit limit, the sale is rejected if outstanding after the due would exceed it.

**Cost rule (decided: moving average).** `stock_balances.averageCost` holds the moving-average unit cost. A stock-in that carries a unit cost (opening, own stock, purchase, transfer in, customer return) blends in: new average = (on hand × average + quantity × unit cost) ÷ (on hand + quantity), rounded to 4 decimals; when nothing is on hand the average is simply that unit cost. A stock-in with no unit cost (an adjustment, say) keeps the average. Stock going out never changes the average. A sale is costed at the average at the moment of sale; the cost amount is quantity times that unit cost, rounded half-up to scale 2. If no average exists yet (stock that never came in with a cost), the product's `purchasePrice` is used, so the sale still posts.

The invoice number is `INV-YEAR-000001`. A held ticket stores cart lines and does not reserve stock, change stock, or post a journal. A posted sale is not edited. Cancel stays rejected.

Phase 08 posts a customer return against a posted sale. Eligible quantity is the sale line quantity minus posted return quantities for that line. A return above that quantity is rejected, including a second return of the same units. The return line amount is the returned quantity's share of what the customer paid for the line (the sale line total: after discount, VAT included), rounded half-up to scale 2; the line's VAT is split by the same share. When the return takes the remaining quantity, the line amount (and its VAT) is the sale line value minus what was already returned on that line, so the pieces always add up to the original. The return total is the sum of those line amounts. Cost of goods for the return uses the unit cost stored on that sale's stock-out row, with the same remaining-quantity rule. The stock movement is `CUSTOMER_RETURN` in. The original sale journal is not edited. The return journal debits 4100 Sales for the return total less its VAT, debits 2300 VAT Payable for the VAT share, credits 1300 Accounts Receivable for the part that reduces the customer's outstanding, and credits 1100 Cash for the remainder. It also debits 1400 Inventory and credits 5100 COGS for the returned cost. Zero lines are omitted. The receivable part is a customer ledger RETURN credit. A walk-in sale has no receivable, so the whole return is a cash refund. The document number is `RET-YEAR-000001`.

## 4. Purchases

```text
Purchase
→ Supplier
→ Branch / warehouse
→ Items
→ Cost
→ Discount / VAT / charges
→ Payment
→ Transaction
   purchase, items, stock increase, stock ledger,
   supplier ledger, payment, accounting, audit
→ Commit
```

Phase 06 calculates each line as quantity times unit cost, rounded half-up to scale 2. The purchase total is the sum of those line totals. Header discount, VAT, and charges stay zero; a purchase that needs a non-zero discount, VAT, or charge is rejected until section 16 defines that math. The purchase journal is Dr 1400 Inventory, Cr 2100 Accounts Payable for the total. A payment uses method CASH (account 1100) or BANK (account 1200) and posts Dr 2100, Cr that account. The payment cannot exceed the purchase total, or the supplier's outstanding payable on a later payment. Supplier ledger credits increase payable and debits decrease it. Opening payable is written once, as an OPENING credit, when the supplier is created. Outstanding payable is the sum of ledger credits minus the sum of ledger debits. A posted purchase is not edited.

Phase 08 posts a supplier return against a posted purchase. Eligible quantity is the purchase line quantity minus posted return quantities for that line. The return line amount uses the purchase unit cost and the same remaining-quantity rule as a customer return. The stock movement is `SUPPLIER_RETURN` out, and it is rejected when that would make stock negative. The return journal credits 1400 Inventory for the return total, debits 2100 Accounts Payable for the part that reduces the supplier's outstanding, and debits 1100 Cash or 1200 Bank for the remainder. The cash or bank method is required only when that remainder is greater than zero. The payable part is a supplier ledger RETURN debit. The document number uses the same `RET` sequence.

## 5. Customer balance

The customer ledger is the source of truth.

```text
Opening
+ Credit sales
− Payments
− Returns
+ Adjustments
= Outstanding balance
```

Phase 07 records the unpaid part of a sale as a customer ledger SALE debit. Debits increase what the customer owes. Credits decrease it. Outstanding is the sum of debits minus the sum of credits. A fully paid sale writes no customer ledger line. Phase 08 records the receivable portion of a customer return as a RETURN credit.

Phase 10 writes an opening balance once, as an OPENING debit, when the customer is created and the amount is greater than zero. That amount is also stored on the customer. It is not edited later, and it is not added again on top of the ledger. When the session has a branch, the opening line also posts Dr 1300 Accounts Receivable, Cr 3100 Owner Capital. A supplier opening posts Dr 3100, Cr 2100 Accounts Payable. A later due collection still posts the frozen customer-payment entry. The collection amount must be greater than zero and cannot exceed the outstanding receivable. It debits 1100 Cash or 1200 Bank, credits 1300 Accounts Receivable, and writes a PAYMENT credit. The receipt number uses the `PAY` sequence. The amount is not split across invoices. SMS is not sent, because no provider is configured. An advance is a separate `customer_advances` row and an ADVANCE credit. It uses the same cash or bank debit and accounts-receivable credit, because no other advance account is named. An advance may exceed the outstanding due. Adjustments are not posted. An installment is a reminder on a posted invoice for that customer. Its amount, with the other reminders on that invoice, cannot exceed the invoice total. Closing a reminder sets it to PAID and posts no money. Interest is not calculated. A reminder is overdue when it is still OPEN and the due date is before today in UTC.

Due collection: select customer and outstanding invoices, payment method, amount, then customer ledger, payment, accounting, receipt, optional SMS. SMS failure must not roll back a committed financial transaction. SMS runs after commit, and a failure is logged for retry.

Advance is a separate document from due collection. It writes an advance record, a customer ledger line, cash or bank, and accounting.

Installments track customer, invoice, amount, due date, and status for upcoming and overdue reminders. Interest is not defined.

## 6. Supplier balance

```text
Opening payable
+ Credit purchases
− Payments
− Returns
+ Adjustments
= Outstanding payable
```

## 7. Accounting

Posted journal invariant:

```text
sum(debit) = sum(credit)
```

Posted journals are not edited in place. Corrections are reversals or new adjustments.

Central service. Source modules call it. They do not post one-off balance updates.

| Event | Entry |
| --- | --- |
| Sale | Dr Cash or Accounts Receivable, Cr Sales Revenue. Dr COGS, Cr Inventory |
| Customer payment | Dr Cash or Bank, Cr Accounts Receivable |
| Customer advance | Dr Cash or Bank, Cr Accounts Receivable |
| Purchase | Dr Inventory, Cr Accounts Payable |
| Supplier payment | Dr Accounts Payable, Cr Cash or Bank |
| Expense | Dr Expense, Cr Cash or Bank |

Cash sale versus credit sale chooses Cash versus Accounts Receivable. A sale that is partly paid posts both, split by the server-calculated paid and due amounts. That split is required by the two sale lines above. It is not an extra policy.

Voucher types: Payment, Receipt, Journal, Contra.

Bank supports opening balance, deposit, withdrawal, transfer, statement. Cash supports opening, cash in, cash out, sales, refund, expense, transfer, closing.

Transaction type enum:

```text
SUPPLIER_DUE_PAYMENT
CONTRA_BALANCE_TRANSFER
DEALER_COLLECTION
SUPPLIER_INSTANT_PAYMENT
SUPPLIER_RETURN_REFUND
LOAN_PAID
LOAN_RECEIVED
CAPITAL_ADDED
CAPITAL_WITHDRAW
EXPENSE_PAYMENT
CUSTOMER_PRODUCT_RETURN
SELL
INDIRECT_INCOME
OTHER_INCOME
LIABILITY_RECEIVED
LIABILITY_PAYMENT
FIXED_ASSET_PURCHASE
CUSTOMER_DUE_RECEIVED
```

Account statement: account, date range, opening, debit, credit, running balance, reference.

Chart of accounts is configurable. The seed list is in `docs/DATABASE.md`.

Phase 09 posts only through the central journal service. A manual journal is posted immediately when its lines balance; a line is a debit or a credit, and the journal total debit must equal the total credit. The number is `VCH-YEAR-000001`. A posted journal is not edited. A reversal is a new posted journal with the lines swapped, linked by `reversalOfId`. A journal that already has a reversal cannot be reversed again. A journal that belongs to a sale, purchase, return, or party payment cannot be reversed here, because that would leave the source document in place. An expense posts Dr an account in group 6000, Cr 1100 Cash or 1200 Bank, numbered `EXP-YEAR-000001`. A contra transfer posts Dr 1200 and Cr 1100, or the opposite, numbered on the `VCH` sequence. An account statement running balance is the opening debit-minus-credit plus each later debit minus credit for the session branch. Other income debits 1100 or a bank account and credits an income account other than 4100. Capital added debits cash or bank and credits 3100. Capital withdrawn debits 3200 and credits cash or bank. A loan received debits cash or bank and credits 2200. A loan paid debits 2200 and credits cash or bank. A payment voucher credits cash or bank. A receipt voucher debits cash or bank. Those vouchers do not post to 1300, 1400, 2100, 4100, or 5100. A new bank account uses the next free code from 1201 to 1299. Its opening balance debits that bank and credits 3100.

## 8. Stock transfer — Option A (decided)

**Conflict.** Statuses:

```text
Draft → Pending Approval → Approved → Transferred → Received
```

The blueprint also says one transaction posts `TRANSFER_OUT` and `TRANSFER_IN` together. The development rules say stock must not leave the source unless the destination receives it.

**Option A — atomic on receive.** Stock stays at the source through Approved. Received posts `TRANSFER_OUT` and `TRANSFER_IN` in one transaction. Nothing is in transit. "Transferred" is either removed or means the same moment as Received.

**Option B — in transit.** Transferred posts `TRANSFER_OUT` from the source and `TRANSFER_IN` to an organization in-transit location in one transaction. Received posts `TRANSFER_OUT` from in-transit and `TRANSFER_IN` to the destination in a second transaction. Stock is always on a ledger.

Option B needs an in-transit location that the current movement list does not name. Option A drops the gap between Transferred and Received.

Option A is the rule. A transfer is received the moment it is posted: `TRANSFER_OUT` and `TRANSFER_IN` post in one transaction, the transfer is saved as `RECEIVED`, and stock does not sit in transit. There is no draft, approval, or transferred step; the unused statuses stay in the schema. The transfer is numbered `TRF-YEAR-000001`, requires an idempotency key, accepts a variant per line, and may only leave a branch the user works in. The goods move at the source's moving-average cost (section 7), which the destination's average then blends in. For an expiry-tracked product the lots used up at the source (earliest expiry first) are recreated at the destination.

## 9. Shifts

```text
OPEN → ACTIVE → CLOSING → CLOSED
```

Tracked amounts: opening cash, cash sales, cash in, cash out, refunds, expected cash, actual cash, difference.

A closed shift cannot close again.

Phase 12 confirms this formula and does not use a second one:

```text
expected = opening + cash sales + cash in − cash out − refunds
difference = actual − expected
```

Opening cash is entered when the shift is opened. It can be zero. Cash in and cash out are drawer movements on an ACTIVE shift. They are not journals. Cash sales are posted cash sale payments on the session branch from the open time until the drawer is counted. Refunds are the cash credits on customer-return journals in that same window. Due collections, expenses, and supplier payments are not part of this formula. The figures are stored when the shift moves to CLOSING and are not recalculated. A handover records an amount from the shift user to another active user while the shift is CLOSING. It does not change expected cash or post a journal.

The status steps are OPEN, then ACTIVE, then CLOSING, then CLOSED. A step cannot be skipped. A user has one shift on a branch until it is CLOSED. Closing a CLOSED shift is rejected.

## 10. Loyalty

Tier: name, minimum spend, discount percent, benefits, status.

Card: number, customer, type, tier, status, issued, expires.

Ledger: `EARN`, `REDEEM`, `EXPIRE`, `ADJUST`, `REVERSAL`.

**Earning (decided).** A posted sale for a customer earns points automatically when the shop has a points-per-hundred rate: `EARN` = sale total × rate ÷ 100, in the same transaction as the sale, with `referenceType = sale`. A blank or zero rate earns nothing. Points are display-only for now: redeeming, expiring, and reversing the earned points when a sale is returned are not built (Phase 7 in `FIX_PLAN.md`), so no money depends on them yet. Redeem conversion and the expiry schedule are not specified.

Phase 10 stores a tier and a card. The tier discount percent is stored and is not applied to a sale price. Earn, redeem, expiry, adjustment, and reversal rows are not posted.

## 11. SMS templates

Allowed variables only:

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

Templates are substituted as text. They are not evaluated as code.

Provider methods go through:

```text
send(message) → result
```

Dashboard figures on the shop screens: sent today, sent this month, sent this year, and total sent. This install does not sell SMS credit, so quantity, price, purchase, and balance are not shown.

Phase 13 stores a template only when every `{variable}` is in the list above. Any other brace is rejected. A send replaces those tokens with the supplied text and removes braces from the values. It does not calculate a bill or a due. The per-SMS price is an organization setting, not a built-in rate. A recharge request stores quantity and amount as quantity times that price, with status REQUESTED. It does not post a journal or take a payment. Until a price is saved, a recharge is rejected. Current quantity is the sum of requested quantities. Total purchase is the sum of those request amounts. Sent counts include only messages marked SENT. Balance is (requested quantity − sent count) times the unit price, and it is not cash in the books. Sender name and provider label are settings. Provider credentials are not stored. `send` uses `SMS_PROVIDER_URL` when that environment variable is set. When it is not set, the message is saved as FAILED, a log and a notification log are written, and no journal is posted. Retry attempts a FAILED message again and appends a log. A SENT message is not retried.

## 12. Quotations and requisitions

Quotation:

```text
Draft → Sent → Accepted → Converted
```

Requisition:

```text
Requested → Approval → Approved or Rejected → Fulfilled
```

A quotation is created as DRAFT for an active customer on the session branch. It can store product lines with a quantity and a unit price. DRAFT can be sent. SENT can be accepted. A status cannot skip a step or move backward. Convert posts a due sale at the quoted unit price, stores that sale on the quotation, and sets the status to ACCEPTED. A quotation with no lines is not converted. There is no separate Converted status. A quotation does not reserve stock before that conversion.

An IMEI is stored only for a product that tracks serial numbers. Selling that product requires one in-stock IMEI and a quantity of one. A warranty claim stores a product, a customer, an optional IMEI, and a note. Closing a claim does not move stock or money. A courier and a shipment are stored rows. No outside courier service is called. BIN, TIN, and a logo address are shop profile fields. A dealer is a customer with the Dealer type. A wallet payment uses the customer's existing credit and debits accounts receivable instead of cash. A direct return puts stock back at the weighted-average stock-in cost and refunds cash or bank. It is rejected when that cost is missing.

A requisition is created as REQUESTED on the session branch. The requester is the signed-in user. REQUESTED can be approved or rejected. APPROVED can be fulfilled. REJECTED and FULFILLED stop. Fulfillment changes the status only. It does not move stock or post a journal. The client does not choose the branch.

## 13. Document numbers

```text
INV, PUR, RET, QUO, REQ, TRF, PAY, EXP, VCH
```

Pattern: `{PREFIX}-{YEAR}-{6-digit sequence}`. Allocation is locked inside the document transaction. Year and sequence scope (organization or branch) is open. See `docs/DATABASE.md`.

## 14. Import, export, and print

```text
Upload CSV → header check → parse → preview → row validation → confirm → batch → summary
```

Summary counts: total, success, failed, skipped. Failed rows are reportable. Each confirmed row is its own transaction, so a failed row leaves an earlier successful row in place.

Product CSV columns are `sku`, `name`, `purchasePrice`, `sellingPrice`, `wholesalePrice`, `minimumPrice`, and optional `reorderLevel` and `barcode`. A blank reorder level is `0`. Track stock is on. Track expiry, batch, serial, and warranty are off. Those match the product form. An existing SKU is skipped and is not updated. A second copy of that SKU in the same file is skipped. A bad header is rejected before any row is saved.

Opening-stock CSV columns are `sku`, `quantity`, and optional `unitCost`, `lot`, `manufacturedOn`, `expiresOn`, and `rack`. Rack is accepted and not stored, because it is not a column. The warehouse is the session branch warehouse. Every valid row goes into one opening-stock document, posted in one transaction, so unit cost is stored on the ledger and is not posted to accounting. A row with an unknown product, a bad date, a bad number, or a missing lot or expiry for an expiry-tracked product fails that row only and is reported; the other rows still post. If the document itself cannot be posted, no row is posted and each says why.

Export is CSV. Product export uses `products.export`. Report export uses `reports.export`. No spreadsheet template is named, so XLSX is not generated.

Print reads stored documents. An invoice prints the sale lines, stored totals, and payments. A thermal receipt is the same text at 80mm. A quotation prints the header, the note, and any stored lines. A voucher prints the journal lines. Barcode labels print the stored barcode, product, and selling price. Copies are a layout count and do not change stock. The barcode report lists those print audits.

## 15. Reports

Phase 14 reads posted rows. It does not post a journal, move stock, or change a ledger. The branch is the session branch. The client does not choose it. A date range uses `occurredOn` and applies only when both dates are valid and the start is not after the end. Dates are UTC calendar dates.

The sales report total is the sum of `POSTED` sale totals on that branch in the range. A draft and another branch are excluded. Returns are not subtracted from that total. The purchase report total is the sum of `POSTED` purchase totals on the same scope.

Customer due is `sum(debit) − sum(credit)` on `customer_ledgers` for the organization. Supplier payable is `sum(credit) − sum(debit)`. The opening column is not added again. These balances are not limited to the session branch, because the ledger outstanding used at payment is organization-wide.

Inventory is one row per `stock_balances` row on the session branch. Status uses the stock alert already in the stock module: quantity zero is out of stock, a positive quantity at or under the product reorder level is low, and a greater quantity is normal.

Cash is posted journal lines on account `1100`. Bank is account `1200`. Debit is in. Credit is out.

The trial balance sums posted debit and posted credit by account on the session branch. Those two totals are equal because each posted journal balances. The day book lists the same posted lines.

Profit and loss uses posted lines in these groups only:

```text
Revenue (4000) = credit − debit
Cost of sales (5000) = debit − credit
Expenses (6000) = debit − credit
Gross profit = revenue − cost of sales
Net = gross profit − expenses
```

Accounts outside those groups are not on this statement. Other income in group 4000 is included in revenue. Assets, liabilities, loans, and capital stay off this statement. The account statement remains the Phase 09 statement.

A loyalty report counts cards and stored point rows. It does not sum points into money. An SMS report counts messages by status and does not post a journal. Report CSV export uses `reports.export`.

## 16. Open decisions

Do not implement these by assumption.

| Topic | Why it is open |
| --- | --- |
| VAT | `vatType` and `vatValue` exist. Inclusive versus exclusive math is not defined |
| Negative stock | Phase 05 requires an insufficient-stock test, which implies rejection, but an override setting is not defined |
| Discount stacking | Line discount versus invoice discount and maximums are not defined |
| Price override limits | Permission exists. Amount limits do not |
| Loyalty rates | The shop enters points per hundred and taka per point. A blank rate does not earn or redeem |
| Installment interest | The shop enters the percent on the reminder. A blank percent shows no interest. Closing a reminder does not collect cash |
| Currency, fiscal year, timezone | Not named. Do not add multi-currency |
| Document sequence scope | Organization-wide versus per branch |
| Shift expected-cash formula | Phase 12 confirms the section 9 formula. Due collections, expenses, and supplier payments are outside it |
| Generic product field | Named in expiry and alert filters, no column |
| Quotation conversion | Convert posts a due sale from stored lines and links `saleId`. A quotation with no lines is rejected |

## 16. Safe technical defaults that are not business rules

These keep the app buildable. They do not decide money or stock policy.

- One currency code stored in organization settings, value unset until settings exist
- Passwords hashed with a current adaptive hash (argon2 or bcrypt). Phase 04 picks one and records it in `docs/SECURITY.md`
- Session stored server-side, cookie httpOnly
- Decimal libraries or integer minor units inside services, never binary float as the stored authority
