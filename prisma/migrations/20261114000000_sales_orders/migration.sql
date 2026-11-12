-- AlterTable
ALTER TABLE `customer_payments` ADD COLUMN `accountId` CHAR(36) NULL,
    ADD COLUMN `charge` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `shiftId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `customers` ADD COLUMN `isSystem` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `document_sequences` MODIFY `documentType` ENUM('STK', 'INV', 'PUR', 'RET', 'QUO', 'REQ', 'TRF', 'PAY', 'EXP', 'VCH', 'ORD', 'RCV') NOT NULL;

-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `loyaltyEarn` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `maxDiscountPercent` DECIMAL(5, 2) NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE `sale_items` ADD COLUMN `priceLevelId` CHAR(36) NULL,
    ADD COLUMN `unitCost` DECIMAL(18, 4) NULL;

-- AlterTable
ALTER TABLE `sale_payments` ADD COLUMN `accountId` CHAR(36) NULL,
    ADD COLUMN `charge` DECIMAL(18, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `sale_returns` ADD COLUMN `refundAccountId` CHAR(36) NULL,
    ADD COLUMN `refundMethod` ENUM('CASH', 'BANK', 'MOBILE', 'ADVANCE', 'AR_ONLY') NULL;

-- AlterTable
ALTER TABLE `sales` ADD COLUMN `districtId` CHAR(36) NULL,
    ADD COLUMN `orderId` CHAR(36) NULL,
    ADD COLUMN `priceLevelId` CHAR(36) NULL,
    ADD COLUMN `shiftId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `sales_orders` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `warehouseId` CHAR(36) NULL,
    `customerId` CHAR(36) NOT NULL,
    `number` VARCHAR(32) NULL,
    `quotationNumber` VARCHAR(32) NULL,
    `isQuotation` BOOLEAN NOT NULL DEFAULT false,
    `validUntil` DATE NULL,
    `status` ENUM('DRAFT', 'CONFIRMED', 'PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'RETURNED') NOT NULL DEFAULT 'DRAFT',
    `channel` ENUM('POS', 'PHONE', 'FACEBOOK', 'WEBSITE', 'OTHER') NOT NULL DEFAULT 'PHONE',
    `priceLevelId` CHAR(36) NULL,
    `deliveryMethod` ENUM('PICKUP', 'OWN_VEHICLE', 'COURIER') NOT NULL DEFAULT 'PICKUP',
    `shippingAddress` VARCHAR(255) NULL,
    `districtId` CHAR(36) NULL,
    `upazilaId` CHAR(36) NULL,
    `externalRef` VARCHAR(64) NULL,
    `expectedDate` DATE NULL,
    `businessDate` DATE NOT NULL,
    `note` VARCHAR(500) NULL,
    `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `discountTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `headerDiscount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `vatTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `chargesTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sales_orders_organizationId_branchId_status_businessDate_idx`(`organizationId`, `branchId`, `status`, `businessDate`),
    INDEX `sales_orders_organizationId_channel_status_idx`(`organizationId`, `channel`, `status`),
    INDEX `sales_orders_organizationId_customerId_idx`(`organizationId`, `customerId`),
    UNIQUE INDEX `sales_orders_organizationId_number_key`(`organizationId`, `number`),
    UNIQUE INDEX `sales_orders_organizationId_quotationNumber_key`(`organizationId`, `quotationNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_order_items` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `productId` CHAR(36) NOT NULL,
    `variantId` CHAR(36) NULL,
    `quantity` DECIMAL(18, 4) NOT NULL,
    `unitPrice` DECIMAL(18, 2) NOT NULL,
    `priceLevelId` CHAR(36) NULL,
    `discountAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `lineTotal` DECIMAL(18, 2) NOT NULL,

    INDEX `sales_order_items_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_events` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `fromStatus` ENUM('DRAFT', 'CONFIRMED', 'PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'RETURNED') NULL,
    `toStatus` ENUM('DRAFT', 'CONFIRMED', 'PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'RETURNED') NOT NULL,
    `userId` CHAR(36) NULL,
    `note` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_events_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `sales_orderId_key` ON `sales`(`orderId`);

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `sales_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_orders` ADD CONSTRAINT `sales_orders_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_orders` ADD CONSTRAINT `sales_orders_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_orders` ADD CONSTRAINT `sales_orders_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_items` ADD CONSTRAINT `sales_order_items_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_items` ADD CONSTRAINT `sales_order_items_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `sales_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_items` ADD CONSTRAINT `sales_order_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `sales_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- P06: the open quotations (not yet turned into a sale) become draft orders marked as quotations, with the same id, number and lines.
-- A quotation that was converted already has its sale; it stays in `quotations` as it was.
INSERT INTO `sales_orders` (`id`, `organizationId`, `branchId`, `customerId`, `quotationNumber`, `isQuotation`, `status`, `channel`, `deliveryMethod`, `businessDate`, `note`, `subtotal`, `total`, `createdById`, `createdAt`, `updatedAt`)
SELECT q.`id`, q.`organizationId`, q.`branchId`, q.`customerId`, q.`number`, TRUE, 'DRAFT', 'PHONE', 'PICKUP', q.`businessDate`, q.`note`,
       COALESCE((SELECT SUM(i.`lineTotal`) FROM `quotation_items` i WHERE i.`quotationId` = q.`id`), 0),
       COALESCE((SELECT SUM(i.`lineTotal`) FROM `quotation_items` i WHERE i.`quotationId` = q.`id`), 0),
       q.`createdById`, q.`createdAt`, NOW(3)
FROM `quotations` q
WHERE q.`saleId` IS NULL;

INSERT INTO `sales_order_items` (`id`, `organizationId`, `orderId`, `position`, `productId`, `quantity`, `unitPrice`, `lineTotal`)
SELECT i.`id`, i.`organizationId`, i.`quotationId`,
       (SELECT COUNT(*) FROM `quotation_items` j WHERE j.`quotationId` = i.`quotationId` AND j.`id` < i.`id`),
       i.`productId`, i.`quantity`, i.`unitPrice`, i.`lineTotal`
FROM `quotation_items` i
JOIN `quotations` q ON q.`id` = i.`quotationId`
WHERE q.`saleId` IS NULL;
