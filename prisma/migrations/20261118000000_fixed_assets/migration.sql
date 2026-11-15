-- AlterTable
ALTER TABLE `document_sequences` MODIFY `documentType` ENUM('STK', 'INV', 'PUR', 'RET', 'QUO', 'REQ', 'TRF', 'PAY', 'EXP', 'VCH', 'ORD', 'RCV', 'SHP', 'SET', 'CTR', 'INC', 'CAP', 'LON', 'AST', 'DEP') NOT NULL;

-- CreateTable
CREATE TABLE `fixed_assets` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` ENUM('VEHICLE', 'FURNITURE', 'COMPUTER', 'WAREHOUSE_EQUIPMENT', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `purchaseDate` DATE NOT NULL,
    `cost` DECIMAL(18, 2) NOT NULL,
    `salvageValue` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `usefulLifeMonths` INTEGER NOT NULL,
    `method` ENUM('STRAIGHT_LINE') NOT NULL DEFAULT 'STRAIGHT_LINE',
    `location` VARCHAR(191) NULL,
    `note` VARCHAR(255) NULL,
    `status` ENUM('ACTIVE', 'DISPOSED') NOT NULL DEFAULT 'ACTIVE',
    `isOpening` BOOLEAN NOT NULL DEFAULT false,
    `openingDepreciation` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `depreciationStartMonth` VARCHAR(7) NOT NULL,
    `depreciationMonths` INTEGER NOT NULL,
    `paidWith` VARCHAR(16) NOT NULL,
    `moneyAccountId` CHAR(36) NULL,
    `vendorId` CHAR(36) NULL,
    `journalId` CHAR(36) NULL,
    `disposedOn` DATE NULL,
    `disposalAmount` DECIMAL(18, 2) NULL,
    `disposalAccountId` CHAR(36) NULL,
    `disposalJournalId` CHAR(36) NULL,
    `disposalNote` VARCHAR(255) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fixed_assets_journalId_key`(`journalId`),
    UNIQUE INDEX `fixed_assets_disposalJournalId_key`(`disposalJournalId`),
    INDEX `fixed_assets_organizationId_status_idx`(`organizationId`, `status`),
    UNIQUE INDEX `fixed_assets_organizationId_code_key`(`organizationId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `depreciation_runs` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `journalId` CHAR(36) NOT NULL,
    `total` DECIMAL(18, 2) NOT NULL,
    `assetCount` INTEGER NOT NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `depreciation_runs_journalId_key`(`journalId`),
    UNIQUE INDEX `depreciation_runs_organizationId_month_key`(`organizationId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `journal_lines_assetId_idx` ON `journal_lines`(`assetId`);

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `fixed_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `depreciation_runs` ADD CONSTRAINT `depreciation_runs_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

