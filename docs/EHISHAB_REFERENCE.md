# eHishab reference gap

The 19 September 2026 screenshot set and the live shop at [pos.ehishab.com](https://pos.ehishab.com) are the same feature set. Meridian takes its menu, screen names, and layout from that source. Credentials are not stored here.

The shell now follows that layout: dark sidebar, Wings / Balance / Sell, search, clock, Open Ticket, and the daily gradient cards. A menu row without a route is still listed and does not open a screen. Posting rules in the blocked section stay closed.

Meridian already has routes for dashboard, POS, shifts, sales, purchases, quotations, requisitions, products, inventory, customers, suppliers, accounting, reports, CRM, SMS, and settings. Most of those screens do not match the reference layout, columns, or actions below.

Do not invent posting rules to copy a reference button. The blocked section at the end stays closed until `docs/BUSINESS_RULES.md` defines the rule.

Each reference phase is finished on its own. The next phase starts only after approval.

| Phase | Scope | Status |
| --- | --- | --- |
| R1 | Shell, sidebar, top bar, daily dashboard cards | Done |
| R2 | Sell register: product search, cart, walking customer, hold, clear, cash or due | Done |
| R3 | All Products table: image, prices, stock in and out, return, values, active state | Done |
| R4 | Customers, take due, advances, installments, loyalty screens | Done |
| R5 | Stock, summary, alert, ledger, damage, expiry, opening and own stock | Done |
| R6 | Purchases, suppliers, quotations, requisitions, returns | Done |
| R7 | Accounting screens that already exist, without new posting rules | Done |
| R8 | SMS, shifts, reports | Done |
| R9 | Settings fields the database already stores | Done |
| R10 | Screens that need a new rule first: handover, courier, warranty, IMEI, VAT, transfer, income, loans, capital | Done |
| 19 | cPanel deployment | Done |
| 20 | Production verification | Done |

## Shell

The reference shell is a dark left sidebar, a white top bar, and gradient dashboard cards.

- Shop title in the sidebar, with a demo-account switcher.
- Sidebar groups that expand in place, with count badges (stock alert, transfer history, installment reminders, due-date invoices).
- Top bar: Wings, Balance, Sell, a global search labeled “Search anything…” with Ctrl+K, a live clock, Open Ticket, English/বাংলা, and the user menu.
- User menu: Profile, Change Password, Clear Cache, My Moments, My Logs, Log Out.
- Footer credit line for the product and the vendor.
- Dashboard titled “Daily Sales & Return Summary”, with an all-branch dropdown and a date picker.
- Gradient cards: Total Sales, Instant Paid, Total Due Sale, Due Received, Total Return, Total Expense, Previous Return, Stock Alert Qty, Total Payment, Due Received Alert, Net Profit, Total Purchases, Wallet Used Balance, Supplier Advance Balance, Customer Advance Balance.
- “Generate All Report”, a Sell & Customers block (total sales, total collections, sales due), and a last-seven-days sales panel that can be hidden.

The dashboard now uses this card layout and reads posted totals for the selected day. Wallet and supplier-advance balances stay at zero because those ledgers are not defined.

## Menus the live shop has and Meridian does not

### Open ticket

- Create Ticket (`/ticket/open`)
- All Ticket (`/ticket/index`)

### Shift management

My Active Shift, Close My Shift, and Shift History are filters on the shift list. Branch Ledger opens the account statement. Expected cash stays opening plus cash sales plus cash in, minus cash out and refunds.

Cash Handover and Handover Report list stored handover amounts. They do not change expected cash and they do not post a journal. A new handover is still recorded only on a closing shift.

### Shop setting and others

Settings stores the shop name, phone, and address on the organization. Slug and status are shown and are not edited. The sell branch is the session branch. SMS sender, provider label, and per-SMS price stay on SMS Settings.

Still absent, because they have no column: proprietor, shop email, BIN, TIN, NID, trade license, website, logo, VAT mode, income-tax mode, invoice branch flag, dashboard card style, and customer points. Currency stays unset.
- Tutorial
- Admin Helper Role & Permissions
- Renew Service and Service Renew History
- Delivery Man
- Courier: Settings, Shipments, API Logs

### Shop branch

- Branch list
- Branch Role Permission, separate from the admin helper roles
- CRM as its own branch screen

### Products

- Add New Product and All Products
- Brands, Categories, Unit Types
- Upload Product By CSV
- Print Barcode / Labels and Barcode Print Report
- Variations
- Expired Products List (present in the screenshot set; badge on the menu)

All Products now shows product info, a photo marker when an image row exists, purchase price, selling price, stock in, stock out, customer return, current stock, purchase value, and selling value. Search and page sizes 25, 50, 100, and 200 are on the page. Image files are not served yet, and Active/Deactive is a label. Turning a product off still deletes it.

### Opening and own stock

- Own Stock
- Opening Stock
- Set Bulk Opening Stock
- Own Stock by CSV
- Own Stock Invoices
- Opening Stock Invoices

### Stock

Product Stocks, Product Summary, and the Product Ledger Table show the current branch. Stock Alert Quantity filters by brand and category, and it can print. Expired Products List filters by lot, generic, brand, category, and status, and it shows days left. Opening Stock and Own Stock list their invoices. Damage posts one product and then lists the records.

Still absent: a bulk damage tick list, bulk opening-stock by branch file, own-stock CSV, and any transfer that moves stock. Transfers stay closed until the in-transit rule is approved.

### SMS panel

SMS Settings, Dashboard & Requests, and SMS Histories are on their own screens. Send SMS has Add New, Customers, and Suppliers, a taka balance, and a character count. Without a provider URL the message is saved as failed. The balance is not cash.

### Customers and loyalty

All Customers now searches by name or phone and pages 25, 50, 100, or 200 rows. Take Payment and Advance Receive search the same way, with up and down keys and Enter. Installment reminders filter to open or overdue. Loyalty tiers and cards still store their fields only.

Still absent: a separate customer code, payment vouchers as their own journal document, batch card generation, and automatic tier upgrade. Points are not earned or redeemed.

### Sell

The reference sell screen (`/branch/sell-new`) is a full register. Meridian now has product search, a cart, a walking customer, hold, clear, and cash or due. These reference controls are still absent:

- Walking customer and customer search, plus add customer from the register
- Hold, Clear, and Exchange
- Sell unit with meter, yard, and roll number
- Product search into a cart with quantity and subtotal
- Invoice lookup by invoice id, customer name, phone, or code
- Discount (F6), other charges (Alt+G), note, date, and due-received date
- Totals: gross, discount, other charges, subtotal, exchange return, amount posted to balance, previous due, advance balance, total payable
- Take payment from the customer account balance (Alt+B)
- Cash (F9) with paid, change, and return change
- Partial payment (Alt+P) with paid, current due, and monthly payable
- Send SMS yes/no on the sale
- Sold Invoices
- IMEI / serial number list
- IMEI warranty
- Warranty: File New Claim and Warranty Claims
- A second Sell entry and a Walking entry in the header

### Returns and quotations

Returnable Product searches a posted sale line and posts the return. Returned Invoice lists those returns. Supplier returns search a posted purchase line. Create Quotation still stores a customer, a date, and a note. All Quotation can be searched. Requisitions filter to approve, approved, rejected, and fulfilled. Purchases and suppliers search by name or number. Supplier payment searches payable balances.

Still absent: a direct return with no invoice, quotation lines, discount, VAT, valid-until, and converting a quotation into a sale. Due-date invoices are not a separate screen.

### Header destinations seen on the dashboard

These sit outside the main sidebar and are not in Meridian:

- Supplier
- Godowns
- Accounts & Reports
- Dealer Wings
Sales by product, payment method, and due sales are report screens. Due is the sale total minus cash on that sale. Customer due collection, customer returns, the expense ledger, supplier payments, and the supplier ledger link to the screens that already post those amounts. The wallet report stays at 0.00 because that ledger is not defined.

### Accounting screens from the screenshot set

The live transaction URL opens an Account & Transaction dashboard. The screenshot set shows the rest of that area:

- Bank & Cash, including cash in hand, cash at bank, and a banks table (name, account number, type, branch, balance, edit, ledger, add bank)
- Transaction history
- Expenses
- Direct income and indirect income
- Vouchers
- Assets, liabilities, loan, and capital
- Account statement and cash flow
- Contra: cash to bank and bank to cash
- Transaction type codes on the history: SDP, CONTRA, CDR, DC, SIP, SIR, LP, LR, CA, CW, E, CPR, S, IE, OE, LB, LBP, ASSET

Bank & Cash shows cash in hand (1100) and cash at bank (1200), plus cash-flow in, out, and net from posted lines. Transaction history can be searched and shows the document source. Expenses, journals, vouchers, and the chart can be searched. Vouchers filter by journal, contra, payment, and receipt. Direct/Indirect Incomes, assets, liabilities, loan, and capital list the chart accounts in those groups and link to the statement. They do not post a new document.

Still absent: many bank accounts with number, type, and branch; bank opening balances; income, asset, liability, loan, and capital documents; payment and receipt vouchers as their own journals; the reference type codes SDP, CDR, SIP, and the rest. Contra between cash and bank already posts under the existing rule.

## What exists, but does not look or behave like the reference

| Area | Meridian today | Reference |
| --- | --- | --- |
| Dashboard | Module links | Gradient daily cards, branch and date filters, report launchers |
| POS | One line, cash or due | Full cart, hold, exchange, units, shortcuts, partial and balance payment |
| Products | Name, SKU, price, stock flag | Image, stock in/out, return, purchase and selling value, active toggle |
| Generic | Treated as category, no column | Its own filter on stock alert and expiry |
| Variations | Stored, plain form | Dedicated variations screen |
| Expiry | A list | Status, brand, category, generic, branch, lot, manufacture and expiry, already expired vs days left, print |
| Damage | A single adjustment | Bulk selection by place, plus a damage history |
| Transfers | Rejected. No stock moves | Branch/godown directions and a history list |
| Racks | A page, no stored rack on the product | Rack management on the sell flow |
| Opening stock | One posting form | Invoice lists and a branch file picker, plus own-stock CSV |
| Banks | Chart account 1200 only | Many bank accounts with number, type, branch, and ledger |
| Due collection | A payment form | Searchable due list and payment vouchers |
| Loyalty | Points exist; earning and redeeming are rejected | Cards, tiers, minimum spend, discount percent, auto-upgrade |
| Quotations | Header and note; conversion is rejected | Line builder with discount, VAT, and validity |
| SMS | Tabs, taka balance, character count, and histories. No provider means the message fails | The same send screen, plus a live provider balance |
| Shifts | Active, close, and history filters, plus the statement link | A separate handover screen and handover report |
| Language | English only | English and বাংলা |
| Shop profile | Name, phone, and address. Slug and status are read-only | BIN, TIN, NID, trade license, logo, VAT and tax mode, invoice branch flag |

## Blocked until a business rule is approved

These controls are on the reference. Copying the button without a rule would invent financial behavior. The screens are open. The posting stays closed.

Cash handover and its report list stored amounts and leave expected cash unchanged. Product VAT type and value, the serial flag, and the warranty flag are listed. Courier and warranty claims have no table. Transfers stay unposted until option A or option B is chosen. Income, loan, and capital rows are listed only when they are already stored. This phase does not create them.

- Line discount and VAT on a sale, and the shop-level VAT and income-tax modes
- Other charges and price override
- Card, bank, and other sale tenders beyond cash and due
- Stock transfer timing and which location loses or gains stock
- Negative stock
- Loyalty earn, redeem, tier discount, and auto-upgrade
- Quotation converted into a sale
- Income, assets, liabilities, loans, capital, and bank opening balances posted to the journal
- Payment vouchers and receipt vouchers posted to the journal
- Contra between cash and bank
- Wallet used as a tender
- Installment interest and the monthly payable figure on partial payment
- Customer points when the shop setting is turned on

Shift expected cash is already defined: opening plus cash sales plus cash in, minus cash out and refunds. That formula stays.
