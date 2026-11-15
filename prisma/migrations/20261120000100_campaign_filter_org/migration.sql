-- AlterTable
ALTER TABLE `sms_campaign_filters` ADD COLUMN `organizationId` CHAR(36) NOT NULL;

-- AddForeignKey
ALTER TABLE `sms_campaign_filters` ADD CONSTRAINT `sms_campaign_filters_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

