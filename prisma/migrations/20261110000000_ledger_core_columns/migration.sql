-- P02 task 1: the ledger core (03_DATA_MODEL.md section 3).
--  * accounts: system flag, kind (cash / bank / mobile) and bank details
--  * account_roles: which account plays which part, so code never names an account by its number (B8)
--  * journals: the document a journal posts (docType, docId) and whether it is the posting or its reversal
--  * journal_lines: party, shift, branch, business date and asset, so sub-ledgers and reports come from the lines
--  * payment_allocations: which part of a receipt or payment settles which invoice or bill
-- Every change keeps the rows that exist: new columns are empty or filled from the data already there.

-- accounts
ALTER TABLE `accounts` ADD COLUMN `accountNumber` VARCHAR(64) NULL,
    ADD COLUMN `bankBranch` VARCHAR(191) NULL,
    ADD COLUMN `bankName` VARCHAR(191) NULL,
    ADD COLUMN `isSystem` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `kind` ENUM('CASH', 'BANK', 'MOBILE', 'OTHER') NOT NULL DEFAULT 'OTHER';

-- The accounts that already exist: 1100 is the cash drawer, 12xx are bank accounts (1200 the default one).
UPDATE `accounts` SET `kind` = 'CASH' WHERE `code` = '1100';
UPDATE `accounts` SET `kind` = 'BANK' WHERE `code` REGEXP '^12[0-9]{2}$';

-- journals
ALTER TABLE `journals` ADD COLUMN `docId` CHAR(36) NULL,
    ADD COLUMN `docType` VARCHAR(32) NULL,
    ADD COLUMN `kind` ENUM('POSTING', 'REVERSAL') NOT NULL DEFAULT 'POSTING';
UPDATE `journals` SET `kind` = 'REVERSAL' WHERE `reversalOfId` IS NOT NULL;
CREATE UNIQUE INDEX `journals_docType_docId_kind_key` ON `journals`(`docType`, `docId`, `kind`);

-- journal_lines: the date and branch come from the journal, then the date becomes required
ALTER TABLE `journal_lines` ADD COLUMN `assetId` CHAR(36) NULL,
    ADD COLUMN `branchId` CHAR(36) NULL,
    ADD COLUMN `businessDate` DATE NULL,
    ADD COLUMN `partyId` CHAR(36) NULL,
    ADD COLUMN `partyType` ENUM('CUSTOMER', 'VENDOR', 'COURIER', 'EMPLOYEE') NULL,
    ADD COLUMN `shiftId` CHAR(36) NULL;
UPDATE `journal_lines` l JOIN `journals` j ON j.`id` = l.`journalId` SET l.`businessDate` = j.`businessDate`, l.`branchId` = j.`branchId`;
ALTER TABLE `journal_lines` MODIFY COLUMN `businessDate` DATE NOT NULL;
CREATE INDEX `journal_lines_organizationId_accountId_businessDate_idx` ON `journal_lines`(`organizationId`, `accountId`, `businessDate`);
CREATE INDEX `journal_lines_organizationId_partyType_partyId_businessDate_idx` ON `journal_lines`(`organizationId`, `partyType`, `partyId`, `businessDate`);
CREATE INDEX `journal_lines_shiftId_idx` ON `journal_lines`(`shiftId`);
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
-- I1, enforced by the database too: a line is a debit or a credit above zero, never both, never negative.
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_one_side_check`
    CHECK (`debit` >= 0 AND `credit` >= 0 AND ((`debit` > 0 AND `credit` = 0) OR (`debit` = 0 AND `credit` > 0)));

-- account_roles
CREATE TABLE `account_roles` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `role` VARCHAR(48) NOT NULL,
    `accountId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `account_roles_accountId_idx`(`accountId`),
    UNIQUE INDEX `account_roles_organizationId_role_key`(`organizationId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `account_roles` ADD CONSTRAINT `account_roles_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `account_roles` ADD CONSTRAINT `account_roles_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- payment_allocations
CREATE TABLE `payment_allocations` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `journalId` CHAR(36) NOT NULL,
    `invoiceId` CHAR(36) NULL,
    `billId` CHAR(36) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_allocations_organizationId_invoiceId_idx`(`organizationId`, `invoiceId`),
    INDEX `payment_allocations_organizationId_billId_idx`(`organizationId`, `billId`),
    INDEX `payment_allocations_journalId_idx`(`journalId`),
    PRIMARY KEY (`id`),
    -- exactly one of invoice and bill, and a positive amount (the two foreign keys below use ON UPDATE RESTRICT: MySQL refuses a CHECK on a column with ON UPDATE CASCADE)
    CONSTRAINT `payment_allocations_target_check` CHECK ((`invoiceId` IS NULL) <> (`billId` IS NULL) AND `amount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_journalId_fkey` FOREIGN KEY (`journalId`) REFERENCES `journals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_billId_fkey` FOREIGN KEY (`billId`) REFERENCES `purchases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
