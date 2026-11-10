-- AlterTable
ALTER TABLE `customer_types` ADD COLUMN `priceLevelId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `product_prices` DROP COLUMN `amount`,
    DROP COLUMN `label`,
    ADD COLUMN `minQty` DECIMAL(18, 4) NOT NULL DEFAULT 1,
    ADD COLUMN `price` DECIMAL(18, 2) NOT NULL,
    ADD COLUMN `priceLevelId` CHAR(36) NOT NULL,
    ADD COLUMN `variantScope` VARCHAR(36) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `products` ADD COLUMN `genericName` VARCHAR(191) NULL,
    ADD COLUMN `isService` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `price_levels` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `price_levels_organizationId_name_key`(`organizationId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `product_prices_priceLevelId_idx` ON `product_prices`(`priceLevelId`);

-- CreateIndex
CREATE UNIQUE INDEX `product_prices_organizationId_productId_variantScope_priceLe_key` ON `product_prices`(`organizationId`, `productId`, `variantScope`, `priceLevelId`, `minQty`);

-- AddForeignKey
ALTER TABLE `product_prices` ADD CONSTRAINT `product_prices_priceLevelId_fkey` FOREIGN KEY (`priceLevelId`) REFERENCES `price_levels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `price_levels` ADD CONSTRAINT `price_levels_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_types` ADD CONSTRAINT `customer_types_priceLevelId_fkey` FOREIGN KEY (`priceLevelId`) REFERENCES `price_levels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: every organization gets the three standard price levels (D6): Retail (the default), Wholesale and Dealer.
INSERT INTO `price_levels` (`id`, `organizationId`, `name`, `isDefault`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT UUID(), o.`id`, 'Retail', 1, 1, NOW(3), NOW(3) FROM `organizations` o;
INSERT INTO `price_levels` (`id`, `organizationId`, `name`, `isDefault`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT UUID(), o.`id`, 'Wholesale', 0, 2, NOW(3), NOW(3) FROM `organizations` o;
INSERT INTO `price_levels` (`id`, `organizationId`, `name`, `isDefault`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT UUID(), o.`id`, 'Dealer', 0, 3, NOW(3), NOW(3) FROM `organizations` o;

-- Data: each product's selling price becomes its Retail price (from quantity 1) and its wholesale price its Wholesale price; a variant
-- that has a price of its own gets a Retail price of its own. The columns on products stay (Retail is mirrored there).
INSERT INTO `product_prices` (`id`, `organizationId`, `productId`, `variantId`, `variantScope`, `priceLevelId`, `minQty`, `price`, `createdAt`, `updatedAt`)
SELECT UUID(), p.`organizationId`, p.`id`, NULL, '', l.`id`, 1, p.`sellingPrice`, NOW(3), NOW(3)
FROM `products` p JOIN `price_levels` l ON l.`organizationId` = p.`organizationId` AND l.`name` = 'Retail';
INSERT INTO `product_prices` (`id`, `organizationId`, `productId`, `variantId`, `variantScope`, `priceLevelId`, `minQty`, `price`, `createdAt`, `updatedAt`)
SELECT UUID(), p.`organizationId`, p.`id`, NULL, '', l.`id`, 1, p.`wholesalePrice`, NOW(3), NOW(3)
FROM `products` p JOIN `price_levels` l ON l.`organizationId` = p.`organizationId` AND l.`name` = 'Wholesale';
INSERT INTO `product_prices` (`id`, `organizationId`, `productId`, `variantId`, `variantScope`, `priceLevelId`, `minQty`, `price`, `createdAt`, `updatedAt`)
SELECT UUID(), v.`organizationId`, v.`productId`, v.`id`, v.`id`, l.`id`, 1, v.`price`, NOW(3), NOW(3)
FROM `product_variants` v JOIN `price_levels` l ON l.`organizationId` = v.`organizationId` AND l.`name` = 'Retail'
WHERE v.`price` IS NOT NULL;
