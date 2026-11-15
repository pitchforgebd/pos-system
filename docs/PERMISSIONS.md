# Permissions

**Status:** Frozen catalog from the blueprint  
**Phase:** 00 — Architecture Freeze  
**Enforcement:** Phase 04. Until then, no permission checks exist because there is no application.

## 1. Model

```text
users
roles
permissions
role_permissions
user_roles
user_branch_access
```

A user has one or more roles. A role has many permissions. Permission checks are a set lookup on the server.

Branch access is separate from permissions. Both must pass.

Frontend hiding is presentation. It is not authorization.

Phase 05 uses the frozen catalog only. Own-stock invoices require `inventory.opening`. No separate own-stock code is added.

## 2. Frozen permission codes

Codes use the blueprint's plural module prefix and verbs. The development prompt's singular examples (`product.view`, `sale.view`) are not a second catalog.

```text
dashboard.view

products.view
products.create
products.edit
products.delete
products.import
products.export

inventory.view
inventory.adjust
inventory.transfer
inventory.damage
inventory.expiry
inventory.opening

sales.view
sales.create
sales.edit
sales.cancel
sales.return
sales.discount
sales.price_override

purchase.view
purchase.create
purchase.edit
purchase.return

customers.view
customers.create
customers.edit
customers.payment
customers.advance
crm.manage
loyalty.manage
quotations.manage
requisitions.manage
shifts.manage
sms.manage

suppliers.view
suppliers.create
suppliers.edit
suppliers.payment

accounting.view
accounting.create
accounting.post
accounting.reverse

reports.view
reports.export

users.view
users.create
users.edit
users.disable

roles.manage
settings.manage
branches.manage
audit.view
posting.backdate
```

`posting.backdate` lets a user post a document dated further back than the organization back-date window (3 days unless the organization changes it). Nobody can post a future date or a date inside a locked period, whatever they hold. `roles.manage` covers create, edit, and permission assignment for roles. `settings.manage` covers settings reads and writes. `users.disable` is the supported way to revoke access. Hard delete of users is not in this catalog.

`branches.manage` opens `/branches`. Super Admin holds it and can create a branch. Admin holds `roles.manage` and the working permissions, and does not hold `branches.manage`. An Admin cannot change a role that holds `branches.manage`, assign that role, or disable that account. Initial branch grants on user create use `users.create`. Later branch-grant changes use `users.edit`. The signed-in user can select only a branch already in `user_branch_access`. POS uses `sales.view` because there is no separate POS code. Warehouses, racks, and API logs stay closed. There is one company. A second organization is not created from the app.

Phase 10 adds `crm.manage` for `/crm` and `loyalty.manage` for `/customers/loyalty`. Customer profiles, dues, advances, and installments stay under the existing customer codes. Phase 11 adds `quotations.manage` for `/quotations` and `requisitions.manage` for `/requisitions`. Phase 12 adds `shifts.manage` for `/shifts`. Phase 13 adds `sms.manage` for `/sms`. SMS history includes the SMS notification log under that code.

## 3. Check order

```text
Authenticate
→ Organization scope
→ Branch scope
→ Permission
→ Resource belongs to that organization (and branch, when the row is branch-owned)
→ Service
```

## 4. Modules with no frozen codes yet

The blueprint does not name permissions for these areas. Do not invent codes during Phase 04 seed beyond the list in section 2. Add a code here, then seed it, when that phase starts:

| Module | Routes that will need a code |
| --- | --- |
| Branches, warehouses, racks | `/branches`, `/warehouses`, `/racks` |
| API logs | not offered |
| Notification screens other than SMS history | not routed |

Proposed pattern, not approved: `<module>.view` and `<module>.manage`. Approval means editing this file before the phase that enforces them.

## 5. Sensitive sales permissions

`sales.discount` and `sales.price_override` are separate from `sales.create`. A cashier with create but without those codes cannot apply a discount or change a price. Thresholds and approval limits are not specified. See open decisions in `docs/BUSINESS_RULES.md`.

## 6. Tests required in Phase 04

- Wrong password
- Missing session on a protected route and on an API route
- Authenticated user, wrong organization
- Authenticated user, branch outside `user_branch_access`
- Authenticated user, missing permission
- Disabled user

## 7. Standard roles (Phase 12)

The seed gives every shop these roles, so the owner gives each person a role instead of building one from the codes above. **Super Admin** is the owner: every permission, and the only role that creates branches. **Admin** holds every permission except `branches.manage`. The four below are filled only when they have no permission yet, so a shop's own changes to them are kept; nothing is ever removed by a later seed. The lists are in `src/modules/access/standard-roles.ts`, and a test checks them.

| Role | What it is for | Permissions |
| --- | --- | --- |
| Manager | Runs the shop day to day: sales, stock, purchases, money and reports. Cannot manage users, roles, branches or settings, close a year or post into a locked past. | `dashboard.view`, `products.view`, `products.create`, `products.edit`, `products.delete`, `products.import`, `products.export`, `products.cost`, `inventory.view`, `inventory.adjust`, `inventory.transfer`, `inventory.damage`, `inventory.expiry`, `inventory.opening`, `inventory.takeoff`, `sales.view`, `sales.create`, `sales.edit`, `sales.cancel`, `sales.return`, `sales.discount`, `sales.price_override`, `sales.price_level`, `returns.without_invoice`, `orders.view`, `orders.create`, `orders.manage`, `shipments.view`, `shipments.manage`, `couriers.settle`, `couriers.approve_difference`, `expenses.accrue`, `purchase.view`, `purchase.create`, `purchase.edit`, `purchase.return`, `customers.view`, `customers.create`, `customers.edit`, `customers.payment`, `customers.advance`, `crm.manage`, `loyalty.manage`, `quotations.manage`, `requisitions.manage`, `shifts.manage`, `sms.manage`, `sms.campaign`, `suppliers.view`, `suppliers.create`, `suppliers.edit`, `suppliers.payment`, `accounting.view`, `accounting.create`, `accounting.post`, `reports.view`, `reports.export`, `reports.profit`, `reports.all_branches`, `users.view`, `audit.view` |
| Cashier | The register: sells, takes money from customers, opens and closes a shift. Sees no cost price, no profit and no reports, gives no discount and changes no price. | `dashboard.view`, `products.view`, `sales.view`, `sales.create`, `customers.view`, `customers.create`, `customers.payment`, `orders.view`, `orders.create`, `shifts.manage` |
| Store keeper | The store: receives purchases, counts and adjusts stock, moves stock between places, records damage and expiry, dispatches orders. Sees no profit and takes no money. | `dashboard.view`, `products.view`, `products.create`, `products.edit`, `inventory.view`, `inventory.adjust`, `inventory.transfer`, `inventory.damage`, `inventory.expiry`, `inventory.opening`, `purchase.view`, `purchase.create`, `suppliers.view`, `orders.view`, `orders.manage`, `shipments.view`, `shipments.manage`, `requisitions.manage` |
| Accountant | The books: accounting entries, vendor and customer payments, every report including profit and cost, the audit log. Does not sell, does not close a year or post into a locked past. | `dashboard.view`, `products.view`, `products.cost`, `sales.view`, `purchase.view`, `customers.view`, `customers.payment`, `customers.advance`, `suppliers.view`, `suppliers.payment`, `inventory.view`, `accounting.view`, `accounting.create`, `accounting.post`, `accounting.reverse`, `expenses.accrue`, `couriers.settle`, `shipments.view`, `reports.view`, `reports.export`, `reports.profit`, `reports.all_branches`, `audit.view` |

Not given to any of the four: `roles.manage`, `branches.manage`, `settings.manage`, `period.close` and `posting.backdate`; the owner decides who holds them.
