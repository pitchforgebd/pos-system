-- P01: the business day. `occurredOn` becomes `businessDate` (the Asia/Dhaka calendar day, see src/core/time),
-- the organization gets its time zone, fiscal year start, period lock and back-date window, and two
-- lookups get an index. Renames keep the data, so this is safe on a database that already has rows.

-- Rename the column in every table that has it (and the indexes that contain it, so they match what Prisma expects).
ALTER TABLE `bank_transactions` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `capital_transactions` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `crm_activities` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `customer_advances` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `customer_ledgers` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `customer_payments` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `damage_records` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `direct_returns` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `expenses` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `income` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `journals` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `loyalty_transactions` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `opening_stocks` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `own_stock_invoices` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `purchase_returns` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `purchases` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `quotations` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `requisitions` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `sale_returns` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `sales` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `supplier_ledgers` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `supplier_payments` RENAME COLUMN `occurredOn` TO `businessDate`;
ALTER TABLE `vouchers` RENAME COLUMN `occurredOn` TO `businessDate`;

ALTER TABLE `bank_transactions` RENAME INDEX `bank_transactions_organizationId_occurredOn_idx` TO `bank_transactions_organizationId_businessDate_idx`;
ALTER TABLE `capital_transactions` RENAME INDEX `capital_transactions_organizationId_occurredOn_idx` TO `capital_transactions_organizationId_businessDate_idx`;
ALTER TABLE `crm_activities` RENAME INDEX `crm_activities_contactId_occurredOn_idx` TO `crm_activities_contactId_businessDate_idx`;
ALTER TABLE `customer_advances` RENAME INDEX `customer_advances_organizationId_customerId_occurredOn_idx` TO `customer_advances_organizationId_customerId_businessDate_idx`;
ALTER TABLE `customer_ledgers` RENAME INDEX `customer_ledgers_organizationId_customerId_occurredOn_idx` TO `customer_ledgers_organizationId_customerId_businessDate_idx`;
ALTER TABLE `customer_payments` RENAME INDEX `customer_payments_organizationId_customerId_occurredOn_idx` TO `customer_payments_organizationId_customerId_businessDate_idx`;
ALTER TABLE `damage_records` RENAME INDEX `damage_records_organizationId_productId_occurredOn_idx` TO `damage_records_organizationId_productId_businessDate_idx`;
ALTER TABLE `direct_returns` RENAME INDEX `direct_returns_organizationId_branchId_occurredOn_idx` TO `direct_returns_organizationId_branchId_businessDate_idx`;
ALTER TABLE `expenses` RENAME INDEX `expenses_organizationId_occurredOn_idx` TO `expenses_organizationId_businessDate_idx`;
ALTER TABLE `income` RENAME INDEX `income_organizationId_occurredOn_idx` TO `income_organizationId_businessDate_idx`;
ALTER TABLE `journals` RENAME INDEX `journals_organizationId_branchId_status_occurredOn_idx` TO `journals_organizationId_branchId_status_businessDate_idx`;
ALTER TABLE `journals` RENAME INDEX `journals_organizationId_status_occurredOn_idx` TO `journals_organizationId_status_businessDate_idx`;
ALTER TABLE `loyalty_transactions` RENAME INDEX `loyalty_transactions_organizationId_customerId_occurredOn_idx` TO `loyalty_transactions_organizationId_customerId_businessDate_idx`;
ALTER TABLE `purchase_returns` RENAME INDEX `purchase_returns_organizationId_branchId_occurredOn_idx` TO `purchase_returns_organizationId_branchId_businessDate_idx`;
ALTER TABLE `purchases` RENAME INDEX `purchases_organizationId_branchId_occurredOn_idx` TO `purchases_organizationId_branchId_businessDate_idx`;
ALTER TABLE `quotations` RENAME INDEX `quotations_organizationId_branchId_occurredOn_idx` TO `quotations_organizationId_branchId_businessDate_idx`;
ALTER TABLE `requisitions` RENAME INDEX `requisitions_organizationId_branchId_occurredOn_idx` TO `requisitions_organizationId_branchId_businessDate_idx`;
ALTER TABLE `sale_returns` RENAME INDEX `sale_returns_organizationId_branchId_occurredOn_idx` TO `sale_returns_organizationId_branchId_businessDate_idx`;
ALTER TABLE `sales` RENAME INDEX `sales_organizationId_branchId_occurredOn_idx` TO `sales_organizationId_branchId_businessDate_idx`;
ALTER TABLE `supplier_ledgers` RENAME INDEX `supplier_ledgers_organizationId_supplierId_occurredOn_idx` TO `supplier_ledgers_organizationId_supplierId_businessDate_idx`;
ALTER TABLE `supplier_payments` RENAME INDEX `supplier_payments_organizationId_supplierId_occurredOn_idx` TO `supplier_payments_organizationId_supplierId_businessDate_idx`;
ALTER TABLE `vouchers` RENAME INDEX `vouchers_organizationId_occurredOn_idx` TO `vouchers_organizationId_businessDate_idx`;

-- Organization: time zone, fiscal year, period lock and back-date window.
ALTER TABLE `organizations`
  ADD COLUMN `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Dhaka',
  ADD COLUMN `fiscalYearStartMonth` INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN `lockedThrough` DATE NULL,
  ADD COLUMN `backdateDays` INTEGER NOT NULL DEFAULT 3;

-- Lookups used by the clean-up job (old idempotency keys) and the login limit (failed logins by action and IP).
CREATE INDEX `idempotency_keys_createdAt_idx` ON `idempotency_keys`(`createdAt`);
CREATE INDEX `audit_logs_action_ip_createdAt_idx` ON `audit_logs`(`action`, `ip`, `createdAt`);
