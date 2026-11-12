-- P05: a purchase's lines keep the order they were typed in.
ALTER TABLE `purchase_items` ADD COLUMN `position` INTEGER NOT NULL DEFAULT 0;
