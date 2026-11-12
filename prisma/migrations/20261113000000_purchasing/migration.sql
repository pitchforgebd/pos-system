-- AlterTable
ALTER TABLE `purchase_items` ADD COLUMN `discount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `expiresOn` DATE NULL,
    ADD COLUMN `landedUnitCost` DECIMAL(18, 4) NULL,
    ADD COLUMN `lot` VARCHAR(64) NULL,
    ADD COLUMN `manufacturedOn` DATE NULL,
    ADD COLUMN `serials` JSON NULL,
    ADD COLUMN `vatAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    MODIFY `unitCost` DECIMAL(18, 4) NOT NULL;

-- AlterTable
ALTER TABLE `purchases` ADD COLUMN `headerDiscount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `note` VARCHAR(500) NULL,
    ADD COLUMN `otherCost` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `receivedOn` DATE NULL,
    ADD COLUMN `supplierInvoiceNo` VARCHAR(64) NULL,
    ADD COLUMN `transportCost` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `transportPaidWith` VARCHAR(16) NULL,
    ADD COLUMN `transporterId` CHAR(36) NULL,
    ADD COLUMN `vehicleNo` VARCHAR(32) NULL,
    MODIFY `status` ENUM('DRAFT', 'POSTED', 'CANCELLED', 'ORDERED', 'RECEIVED') NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE `supplier_payments` ADD COLUMN `accountId` CHAR(36) NULL,
    ADD COLUMN `charge` DECIMAL(18, 2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `supplier_advances` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `number` VARCHAR(32) NULL,
    `businessDate` DATE NOT NULL,
    `accountId` CHAR(36) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `journalId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `supplier_advances_journalId_key`(`journalId`),
    INDEX `supplier_advances_organizationId_supplierId_businessDate_idx`(`organizationId`, `supplierId`, `businessDate`),
    UNIQUE INDEX `supplier_advances_organizationId_number_key`(`organizationId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `purchases_organizationId_branchId_status_businessDate_idx` ON `purchases`(`organizationId`, `branchId`, `status`, `businessDate`);

-- AddForeignKey
ALTER TABLE `supplier_advances` ADD CONSTRAINT `supplier_advances_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_advances` ADD CONSTRAINT `supplier_advances_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_advances` ADD CONSTRAINT `supplier_advances_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_advances` ADD CONSTRAINT `supplier_advances_journalId_fkey` FOREIGN KEY (`journalId`) REFERENCES `journals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: a purchase that was posted is a purchase that was received (on the day it was made), and its own prices keep working.
UPDATE `purchases` SET `status` = 'RECEIVED', `receivedOn` = `businessDate` WHERE `status` = 'POSTED';
ALTER TABLE `purchases` MODIFY `status` ENUM('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';

-- Data: what the vendor was owed for each existing bill is its total; its goods cost what they cost at the line (no discount, VAT or haulage then).
UPDATE `purchase_items` SET `landedUnitCost` = `unitCost` WHERE `landedUnitCost` IS NULL;
