-- P08: shifts are required only where the shop turned that on.
ALTER TABLE `organizations` ALTER COLUMN `requireShift` SET DEFAULT false;
