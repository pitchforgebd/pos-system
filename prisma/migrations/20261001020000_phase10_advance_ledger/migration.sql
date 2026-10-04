-- AlterEnum
ALTER TABLE `customer_ledgers` MODIFY `entryType` ENUM('OPENING', 'SALE', 'PAYMENT', 'RETURN', 'ADJUSTMENT', 'ADVANCE') NOT NULL;
