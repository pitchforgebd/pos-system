-- AlterTable
ALTER TABLE `expiry_batches` ADD COLUMN `variantScope` VARCHAR(36) NOT NULL DEFAULT '',
    ADD COLUMN `warehouseId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `product_serials` ADD COLUMN `inMovementId` CHAR(36) NULL,
    ADD COLUMN `variantId` CHAR(36) NULL,
    ADD COLUMN `warehouseId` CHAR(36) NULL,
    MODIFY `status` ENUM('IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'DAMAGED') NOT NULL DEFAULT 'IN_STOCK';

-- AlterTable
ALTER TABLE `stock_balances` ADD COLUMN `reservedQty` DECIMAL(18, 4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `stock_ledgers` ADD COLUMN `businessDate` DATE NOT NULL DEFAULT (curdate()),
    ADD COLUMN `totalCost` DECIMAL(18, 2) NULL,
    MODIFY `movementType` ENUM('TAKE_OFF', 'OPENING', 'PURCHASE', 'SALE', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRY', 'ADJUSTMENT', 'OWN_STOCK') NOT NULL,
    MODIFY `unitCost` DECIMAL(18, 4) NULL;

-- CreateTable
CREATE TABLE `stock_documents` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `warehouseId` CHAR(36) NOT NULL,
    `type` ENUM('OPENING', 'OWN', 'ADJUST', 'DAMAGE', 'EXPIRY', 'TAKE_OFF', 'TRANSFER') NOT NULL,
    `number` VARCHAR(32) NULL,
    `businessDate` DATE NOT NULL,
    `reason` VARCHAR(255) NULL,
    `place` VARCHAR(191) NULL,
    `takeOffPurpose` ENUM('SAMPLE', 'DEMO', 'FIELD_TRIAL', 'OWN_USE', 'GIFT') NULL,
    `recipient` VARCHAR(191) NULL,
    `approvedBy` VARCHAR(191) NULL,
    `note` VARCHAR(500) NULL,
    `expenseAccountId` CHAR(36) NULL,
    `journalId` CHAR(36) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `stock_documents_journalId_key`(`journalId`),
    INDEX `stock_documents_organizationId_branchId_type_businessDate_idx`(`organizationId`, `branchId`, `type`, `businessDate`),
    UNIQUE INDEX `stock_documents_organizationId_number_key`(`organizationId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_reservations` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `orderItemId` CHAR(36) NULL,
    `productId` CHAR(36) NOT NULL,
    `variantId` CHAR(36) NULL,
    `warehouseId` CHAR(36) NOT NULL,
    `quantity` DECIMAL(18, 4) NOT NULL,
    `status` ENUM('ACTIVE', 'RELEASED', 'CONSUMED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `stock_reservations_organizationId_orderId_idx`(`organizationId`, `orderId`),
    INDEX `stock_reservations_organizationId_productId_warehouseId_stat_idx`(`organizationId`, `productId`, `warehouseId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `stock_ledgers_organizationId_businessDate_idx` ON `stock_ledgers`(`organizationId`, `businessDate`);

-- AddForeignKey
ALTER TABLE `stock_documents` ADD CONSTRAINT `stock_documents_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_documents` ADD CONSTRAINT `stock_documents_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_documents` ADD CONSTRAINT `stock_documents_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_documents` ADD CONSTRAINT `stock_documents_journalId_fkey` FOREIGN KEY (`journalId`) REFERENCES `journals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `product_serials` ADD CONSTRAINT `product_serials_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: the lots of an existing database belong to the warehouse that holds their stock (else the branch's first warehouse),
-- and one row per lot: duplicates of the same lot are added together before the unique key is set.
UPDATE `expiry_batches` e
SET e.`variantScope` = COALESCE(e.`variantId`, ''),
    e.`warehouseId` = COALESCE(
      (SELECT sb.`warehouseId` FROM `stock_balances` sb
        WHERE sb.`organizationId` = e.`organizationId` AND sb.`productId` = e.`productId` AND sb.`variantScope` = COALESCE(e.`variantId`, '') AND sb.`branchId` = e.`branchId`
        ORDER BY sb.`quantity` DESC, sb.`warehouseId` LIMIT 1),
      (SELECT w.`id` FROM `warehouses` w WHERE w.`branchId` = e.`branchId` ORDER BY w.`createdAt`, w.`id` LIMIT 1))
WHERE e.`warehouseId` IS NULL;

UPDATE `expiry_batches` k
JOIN (
  SELECT MIN(`id`) AS keepId, SUM(`quantity`) AS total
  FROM `expiry_batches`
  GROUP BY `organizationId`, `warehouseId`, `productId`, `variantScope`, `lot`, `expiresOn`
  HAVING COUNT(*) > 1
) d ON d.keepId = k.`id`
SET k.`quantity` = d.total;

DELETE x FROM `expiry_batches` x
JOIN `expiry_batches` k
  ON k.`organizationId` = x.`organizationId` AND k.`warehouseId` = x.`warehouseId` AND k.`productId` = x.`productId`
 AND k.`variantScope` = x.`variantScope` AND k.`lot` = x.`lot` AND k.`expiresOn` = x.`expiresOn` AND k.`id` < x.`id`;

ALTER TABLE `expiry_batches` MODIFY `warehouseId` CHAR(36) NOT NULL;

CREATE UNIQUE INDEX `expiry_batches_organizationId_warehouseId_productId_variantS_key` ON `expiry_batches`(`organizationId`, `warehouseId`, `productId`, `variantScope`, `lot`, `expiresOn`);

ALTER TABLE `expiry_batches` ADD CONSTRAINT `expiry_batches_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: existing ledger rows get their day (Dhaka, UTC+6, from when they were written) and what they were worth.
UPDATE `stock_ledgers`
SET `businessDate` = DATE(DATE_ADD(`createdAt`, INTERVAL 6 HOUR)),
    `totalCost` = CASE WHEN `unitCost` IS NULL THEN NULL ELSE ROUND(`quantity` * `unitCost`, 2) END;

-- Data: the documents that had a table of their own become rows of stock_documents with the same id, so the ledger rows
-- that point at them still find them. The old tables stay where they are (nothing is dropped).
INSERT INTO `stock_documents` (`id`, `organizationId`, `branchId`, `warehouseId`, `type`, `number`, `businessDate`, `createdAt`)
SELECT o.`id`, o.`organizationId`, o.`branchId`, o.`warehouseId`, 'OPENING', o.`number`, o.`businessDate`, o.`createdAt` FROM `opening_stocks` o;

INSERT INTO `stock_documents` (`id`, `organizationId`, `branchId`, `warehouseId`, `type`, `number`, `businessDate`, `createdAt`)
SELECT o.`id`, o.`organizationId`, o.`branchId`, o.`warehouseId`, 'OWN', o.`number`, o.`businessDate`, o.`createdAt` FROM `own_stock_invoices` o;

INSERT INTO `stock_documents` (`id`, `organizationId`, `branchId`, `warehouseId`, `type`, `businessDate`, `reason`, `createdAt`)
SELECT a.`id`, a.`organizationId`, a.`branchId`, a.`warehouseId`, 'ADJUST', DATE(DATE_ADD(a.`createdAt`, INTERVAL 6 HOUR)), a.`reason`, a.`createdAt` FROM `stock_adjustments` a;

INSERT INTO `stock_documents` (`id`, `organizationId`, `branchId`, `warehouseId`, `type`, `businessDate`, `reason`, `place`, `createdAt`)
SELECT d.`id`, d.`organizationId`, d.`branchId`,
       COALESCE((SELECT l.`warehouseId` FROM `stock_ledgers` l WHERE l.`referenceId` = d.`id` AND l.`warehouseId` IS NOT NULL LIMIT 1),
                (SELECT w.`id` FROM `warehouses` w WHERE w.`branchId` = d.`branchId` ORDER BY w.`createdAt`, w.`id` LIMIT 1)),
       'DAMAGE', d.`businessDate`, d.`reason`, d.`place`, d.`createdAt`
FROM `damage_records` d
WHERE COALESCE((SELECT l.`warehouseId` FROM `stock_ledgers` l WHERE l.`referenceId` = d.`id` AND l.`warehouseId` IS NOT NULL LIMIT 1),
               (SELECT w.`id` FROM `warehouses` w WHERE w.`branchId` = d.`branchId` ORDER BY w.`createdAt`, w.`id` LIMIT 1)) IS NOT NULL;
