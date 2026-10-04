-- CreateTable
CREATE TABLE `quotations` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `number` VARCHAR(32) NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'ACCEPTED') NOT NULL DEFAULT 'DRAFT',
    `occurredOn` DATE NOT NULL,
    `note` VARCHAR(255) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `quotations_organizationId_number_key`(`organizationId`, `number`),
    INDEX `quotations_organizationId_branchId_occurredOn_idx`(`organizationId`, `branchId`, `occurredOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `requisitions` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `number` VARCHAR(32) NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'FULFILLED') NOT NULL DEFAULT 'REQUESTED',
    `occurredOn` DATE NOT NULL,
    `note` VARCHAR(255) NOT NULL,
    `requestedById` CHAR(36) NOT NULL,
    `decidedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `requisitions_organizationId_number_key`(`organizationId`, `number`),
    INDEX `requisitions_organizationId_branchId_occurredOn_idx`(`organizationId`, `branchId`, `occurredOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `requisitions` ADD CONSTRAINT `requisitions_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `requisitions` ADD CONSTRAINT `requisitions_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `requisitions` ADD CONSTRAINT `requisitions_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `requisitions` ADD CONSTRAINT `requisitions_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
