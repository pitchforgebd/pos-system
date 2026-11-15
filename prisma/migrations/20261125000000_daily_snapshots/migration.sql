-- CreateTable
CREATE TABLE `daily_snapshots` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `businessDate` DATE NOT NULL,
    `cash` DECIMAL(18, 2) NOT NULL,
    `bank` DECIMAL(18, 2) NOT NULL,
    `stockValue` DECIMAL(18, 2) NOT NULL,
    `receivable` DECIMAL(18, 2) NOT NULL,
    `payable` DECIMAL(18, 2) NOT NULL,
    `courierOwes` DECIMAL(18, 2) NOT NULL,
    `stale` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `daily_snapshots_organizationId_stale_idx`(`organizationId`, `stale`),
    UNIQUE INDEX `daily_snapshots_organizationId_branchId_businessDate_key`(`organizationId`, `branchId`, `businessDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `daily_snapshots` ADD CONSTRAINT `daily_snapshots_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_snapshots` ADD CONSTRAINT `daily_snapshots_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

