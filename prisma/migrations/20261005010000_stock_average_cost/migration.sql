-- Moving-average unit cost, kept on the stock balance and updated by every stock-in that has a cost.
ALTER TABLE `stock_balances` ADD COLUMN `averageCost` DECIMAL(18, 4) NULL;

-- Start existing balances from the cost-weighted average of their stock-in rows.
UPDATE `stock_balances` AS `b`
SET `b`.`averageCost` = (
  SELECT ROUND(SUM(`l`.`quantity` * `l`.`unitCost`) / SUM(`l`.`quantity`), 4)
  FROM `stock_ledgers` AS `l`
  WHERE `l`.`organizationId` = `b`.`organizationId`
    AND `l`.`productId` = `b`.`productId`
    AND `l`.`variantId` <=> `b`.`variantId`
    AND `l`.`branchId` = `b`.`branchId`
    AND `l`.`warehouseId` <=> `b`.`warehouseId`
    AND `l`.`direction` = 'IN'
    AND `l`.`unitCost` IS NOT NULL
    AND `l`.`quantity` > 0
);
