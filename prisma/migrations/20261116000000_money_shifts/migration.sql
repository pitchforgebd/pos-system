-- AlterTable
ALTER TABLE `document_sequences` MODIFY `documentType` ENUM('STK', 'INV', 'PUR', 'RET', 'QUO', 'REQ', 'TRF', 'PAY', 'EXP', 'VCH', 'ORD', 'RCV', 'SHP', 'SET', 'CTR', 'INC', 'CAP', 'LON') NOT NULL;

-- AlterTable
ALTER TABLE `expenses` ADD COLUMN `categoryId` CHAR(36) NULL,
    ADD COLUMN `charge` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `moneyAccountId` CHAR(36) NULL,
    ADD COLUMN `periodMonth` VARCHAR(7) NULL,
    ADD COLUMN `recurringId` CHAR(36) NULL,
    ADD COLUMN `settleJournalId` CHAR(36) NULL,
    ADD COLUMN `settledOn` DATE NULL,
    ADD COLUMN `shiftId` CHAR(36) NULL,
    ADD COLUMN `status` ENUM('DRAFT', 'PAID', 'ACCRUED') NOT NULL DEFAULT 'PAID';

-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `requireShift` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `shifts` ADD COLUMN `cashAccountId` CHAR(36) NULL,
    ADD COLUMN `denominations` JSON NULL,
    ADD COLUMN `varianceJournalId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `expense_categories` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `accountId` CHAR(36) NOT NULL,
    `type` ENUM('MONTHLY_FIXED', 'VARIABLE', 'MISC') NOT NULL DEFAULT 'VARIABLE',
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `expense_categories_organizationId_name_key`(`organizationId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recurring_expenses` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `dayOfMonth` INTEGER NOT NULL DEFAULT 1,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `note` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recurring_expenses_organizationId_active_idx`(`organizationId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contra_transfers` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `number` VARCHAR(32) NULL,
    `businessDate` DATE NOT NULL,
    `fromAccountId` CHAR(36) NOT NULL,
    `toAccountId` CHAR(36) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `charge` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `shiftId` CHAR(36) NULL,
    `note` VARCHAR(255) NULL,
    `journalId` CHAR(36) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `contra_transfers_journalId_key`(`journalId`),
    INDEX `contra_transfers_organizationId_branchId_businessDate_idx`(`organizationId`, `branchId`, `businessDate`),
    UNIQUE INDEX `contra_transfers_organizationId_number_key`(`organizationId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_method_charges` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `accountId` CHAR(36) NOT NULL,
    `percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `fixed` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `bearer` ENUM('SHOP', 'CUSTOMER') NOT NULL DEFAULT 'SHOP',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_method_charges_organizationId_accountId_key`(`organizationId`, `accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `expenses_settleJournalId_key` ON `expenses`(`settleJournalId`);

-- CreateIndex
CREATE INDEX `expenses_organizationId_periodMonth_status_idx` ON `expenses`(`organizationId`, `periodMonth`, `status`);

-- CreateIndex
CREATE UNIQUE INDEX `expenses_recurringId_periodMonth_key` ON `expenses`(`recurringId`, `periodMonth`);

-- CreateIndex
CREATE UNIQUE INDEX `shifts_varianceJournalId_key` ON `shifts`(`varianceJournalId`);

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `expense_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_categories` ADD CONSTRAINT `expense_categories_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recurring_expenses` ADD CONSTRAINT `recurring_expenses_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recurring_expenses` ADD CONSTRAINT `recurring_expenses_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `expense_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contra_transfers` ADD CONSTRAINT `contra_transfers_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contra_transfers` ADD CONSTRAINT `contra_transfers_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_method_charges` ADD CONSTRAINT `payment_method_charges_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- P08 (D17): shops that already run keep working as they did; a new shop starts with shifts required (it can switch this off).
UPDATE `organizations` SET `requireShift` = FALSE;
