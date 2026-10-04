-- Phase 17. Indexes for filters EXPLAIN did not cover.

CREATE INDEX `users_email_idx` ON `users`(`email`);

CREATE INDEX `products_organizationId_deletedAt_name_idx` ON `products`(`organizationId`, `deletedAt`, `name`);

CREATE INDEX `stock_ledgers_organizationId_branchId_createdAt_idx` ON `stock_ledgers`(`organizationId`, `branchId`, `createdAt`);

CREATE INDEX `sale_payments_organizationId_method_createdAt_idx` ON `sale_payments`(`organizationId`, `method`, `createdAt`);

CREATE INDEX `journals_organizationId_branchId_status_occurredOn_idx` ON `journals`(`organizationId`, `branchId`, `status`, `occurredOn`);
