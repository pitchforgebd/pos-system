-- P06: the lots a sale line took its stock from, so a return goes back to them.
ALTER TABLE `sale_items` ADD COLUMN `lots` JSON NULL;
