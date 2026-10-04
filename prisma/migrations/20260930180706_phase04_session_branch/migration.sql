-- AlterTable
ALTER TABLE `audit_logs` MODIFY `organizationId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `sessions` ADD COLUMN `branchId` CHAR(36) NULL;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
