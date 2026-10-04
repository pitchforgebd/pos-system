ALTER TABLE `organizations`
  ADD COLUMN `bin` VARCHAR(32) NULL,
  ADD COLUMN `tin` VARCHAR(32) NULL,
  ADD COLUMN `logoUrl` VARCHAR(255) NULL,
  ADD COLUMN `pointsPerHundred` DECIMAL(18, 4) NULL,
  ADD COLUMN `takaPerPoint` DECIMAL(18, 4) NULL;

ALTER TABLE `installments`
  ADD COLUMN `interestPercent` DECIMAL(8, 2) NULL;

ALTER TABLE `quotations`
  ADD COLUMN `saleId` CHAR(36) NULL,
  ADD UNIQUE INDEX `quotations_saleId_key` (`saleId`),
  ADD CONSTRAINT `quotations_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `quotation_items` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `quotationId` CHAR(36) NOT NULL,
  `productId` CHAR(36) NOT NULL,
  `quantity` DECIMAL(18, 4) NOT NULL,
  `unitPrice` DECIMAL(18, 2) NOT NULL,
  `lineTotal` DECIMAL(18, 2) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `quotation_items_quotationId_idx` (`quotationId`),
  CONSTRAINT `quotation_items_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `quotation_items_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `quotations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `quotation_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_serials` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `productId` CHAR(36) NOT NULL,
  `serial` VARCHAR(64) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'IN_STOCK',
  `saleId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `product_serials_organizationId_serial_key` (`organizationId`, `serial`),
  INDEX `product_serials_productId_status_idx` (`productId`, `status`),
  CONSTRAINT `product_serials_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `product_serials_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `product_serials_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `warranty_claims` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `branchId` CHAR(36) NOT NULL,
  `productId` CHAR(36) NOT NULL,
  `customerId` CHAR(36) NOT NULL,
  `serial` VARCHAR(64) NULL,
  `note` VARCHAR(255) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `warranty_claims_organizationId_status_idx` (`organizationId`, `status`),
  CONSTRAINT `warranty_claims_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `warranty_claims_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `warranty_claims_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `warranty_claims_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `couriers` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(32) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `couriers_organizationId_name_idx` (`organizationId`, `name`),
  CONSTRAINT `couriers_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `shipments` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `branchId` CHAR(36) NOT NULL,
  `courierId` CHAR(36) NOT NULL,
  `customerId` CHAR(36) NULL,
  `reference` VARCHAR(64) NULL,
  `trackingCode` VARCHAR(64) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `shipments_organizationId_branchId_idx` (`organizationId`, `branchId`),
  CONSTRAINT `shipments_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `shipments_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `shipments_courierId_fkey` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `shipments_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `direct_returns` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `branchId` CHAR(36) NOT NULL,
  `warehouseId` CHAR(36) NOT NULL,
  `productId` CHAR(36) NOT NULL,
  `customerId` CHAR(36) NULL,
  `quantity` DECIMAL(18, 4) NOT NULL,
  `refundAmount` DECIMAL(18, 2) NOT NULL,
  `method` VARCHAR(16) NOT NULL,
  `journalId` CHAR(36) NULL,
  `occurredOn` DATE NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `direct_returns_journalId_key` (`journalId`),
  INDEX `direct_returns_organizationId_branchId_occurredOn_idx` (`organizationId`, `branchId`, `occurredOn`),
  CONSTRAINT `direct_returns_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `direct_returns_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `direct_returns_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `direct_returns_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `direct_returns_journalId_fkey` FOREIGN KEY (`journalId`) REFERENCES `journals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
