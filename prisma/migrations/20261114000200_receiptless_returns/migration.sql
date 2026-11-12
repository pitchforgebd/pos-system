-- CreateTable
CREATE TABLE `receiptless_returns` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `customerId` CHAR(36) NULL,
    `number` VARCHAR(32) NULL,
    `businessDate` DATE NOT NULL,
    `total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `vatTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `refundMethod` ENUM('CASH', 'BANK', 'MOBILE', 'ADVANCE', 'AR_ONLY') NOT NULL,
    `refundAccountId` CHAR(36) NULL,
    `reason` VARCHAR(255) NOT NULL,
    `approvedById` CHAR(36) NOT NULL,
    `createdById` CHAR(36) NOT NULL,
    `journalId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `receiptless_returns_journalId_key`(`journalId`),
    INDEX `receiptless_returns_organizationId_branchId_businessDate_idx`(`organizationId`, `branchId`, `businessDate`),
    UNIQUE INDEX `receiptless_returns_organizationId_number_key`(`organizationId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receiptless_return_items` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `returnId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `variantId` CHAR(36) NULL,
    `quantity` DECIMAL(18, 4) NOT NULL,
    `unitRefund` DECIMAL(18, 2) NOT NULL,
    `vatAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `unitCost` DECIMAL(18, 4) NOT NULL,
    `lineTotal` DECIMAL(18, 2) NOT NULL,

    INDEX `receiptless_return_items_returnId_idx`(`returnId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `receiptless_returns` ADD CONSTRAINT `receiptless_returns_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receiptless_returns` ADD CONSTRAINT `receiptless_returns_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receiptless_return_items` ADD CONSTRAINT `receiptless_return_items_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receiptless_return_items` ADD CONSTRAINT `receiptless_return_items_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `receiptless_returns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receiptless_return_items` ADD CONSTRAINT `receiptless_return_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

