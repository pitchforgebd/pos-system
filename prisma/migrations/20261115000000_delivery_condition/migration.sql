-- P07: the old stub shipments (status was free text) become CREATED before the status is a real enum.
UPDATE `shipments` SET `status` = 'CREATED' WHERE `status` NOT IN ('CREATED', 'PICKED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'LOST');

-- AlterTable
ALTER TABLE `couriers` ADD COLUMN `apiProvider` VARCHAR(32) NULL,
    ADD COLUMN `defaultConditionPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `defaultDeliveryCharge` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `outsideDeliveryCharge` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE `document_sequences` MODIFY `documentType` ENUM('STK', 'INV', 'PUR', 'RET', 'QUO', 'REQ', 'TRF', 'PAY', 'EXP', 'VCH', 'ORD', 'RCV', 'SHP', 'SET') NOT NULL;

-- AlterTable
ALTER TABLE `shipments` ADD COLUMN `address` VARCHAR(255) NULL,
    ADD COLUMN `codAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `conditionCharge` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `conditionPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `createdById` CHAR(36) NULL,
    ADD COLUMN `deliveredOn` DATE NULL,
    ADD COLUMN `deliveryAccountId` CHAR(36) NULL,
    ADD COLUMN `deliveryCharge` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `deliveryPaidWith` VARCHAR(8) NULL,
    ADD COLUMN `dispatchedOn` DATE NULL,
    ADD COLUMN `driverName` VARCHAR(191) NULL,
    ADD COLUMN `driverPhone` VARCHAR(32) NULL,
    ADD COLUMN `journalId` CHAR(36) NULL,
    ADD COLUMN `method` ENUM('PICKUP', 'OWN_VEHICLE', 'COURIER') NOT NULL DEFAULT 'COURIER',
    ADD COLUMN `number` VARCHAR(32) NULL,
    ADD COLUMN `orderId` CHAR(36) NULL,
    ADD COLUMN `returnCharge` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `returnedOn` DATE NULL,
    ADD COLUMN `saleId` CHAR(36) NULL,
    ADD COLUMN `vehicleNo` VARCHAR(32) NULL,
    MODIFY `courierId` CHAR(36) NULL,
    MODIFY `status` ENUM('CREATED', 'PICKED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'LOST') NOT NULL DEFAULT 'CREATED';

-- CreateTable
CREATE TABLE `shipment_events` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `shipmentId` CHAR(36) NOT NULL,
    `status` ENUM('CREATED', 'PICKED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'LOST') NOT NULL,
    `note` VARCHAR(255) NULL,
    `userId` CHAR(36) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shipment_events_shipmentId_at_idx`(`shipmentId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courier_settlements` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `courierId` CHAR(36) NOT NULL,
    `accountId` CHAR(36) NOT NULL,
    `number` VARCHAR(32) NULL,
    `businessDate` DATE NOT NULL,
    `grossCod` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `deliveryCharges` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `conditionCharges` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `expected` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `netReceived` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `difference` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `differenceReason` VARCHAR(255) NULL,
    `approvedById` CHAR(36) NULL,
    `journalId` CHAR(36) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `courier_settlements_journalId_key`(`journalId`),
    INDEX `courier_settlements_organizationId_courierId_businessDate_idx`(`organizationId`, `courierId`, `businessDate`),
    UNIQUE INDEX `courier_settlements_organizationId_number_key`(`organizationId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courier_settlement_items` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `settlementId` CHAR(36) NOT NULL,
    `shipmentId` CHAR(36) NOT NULL,
    `codAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `deliveryCharge` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `conditionCharge` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,

    UNIQUE INDEX `courier_settlement_items_shipmentId_key`(`shipmentId`),
    INDEX `courier_settlement_items_settlementId_idx`(`settlementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `shipments_saleId_key` ON `shipments`(`saleId`);

-- CreateIndex
CREATE UNIQUE INDEX `shipments_journalId_key` ON `shipments`(`journalId`);

-- CreateIndex
CREATE INDEX `shipments_organizationId_status_courierId_idx` ON `shipments`(`organizationId`, `status`, `courierId`);

-- CreateIndex
CREATE UNIQUE INDEX `shipments_organizationId_number_key` ON `shipments`(`organizationId`, `number`);

-- AddForeignKey
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shipment_events` ADD CONSTRAINT `shipment_events_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shipment_events` ADD CONSTRAINT `shipment_events_shipmentId_fkey` FOREIGN KEY (`shipmentId`) REFERENCES `shipments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_settlements` ADD CONSTRAINT `courier_settlements_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_settlements` ADD CONSTRAINT `courier_settlements_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_settlements` ADD CONSTRAINT `courier_settlements_courierId_fkey` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_settlement_items` ADD CONSTRAINT `courier_settlement_items_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_settlement_items` ADD CONSTRAINT `courier_settlement_items_settlementId_fkey` FOREIGN KEY (`settlementId`) REFERENCES `courier_settlements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_settlement_items` ADD CONSTRAINT `courier_settlement_items_shipmentId_fkey` FOREIGN KEY (`shipmentId`) REFERENCES `shipments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

