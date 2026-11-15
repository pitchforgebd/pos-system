-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `idleTimeoutMinutes` INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE `sessions` ADD COLUMN `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateTable
CREATE TABLE `rate_limits` (
    `id` CHAR(36) NOT NULL,
    `scope` VARCHAR(32) NOT NULL,
    `keyHash` CHAR(64) NOT NULL,
    `windowStart` DATETIME(3) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rate_limits_windowStart_idx`(`windowStart`),
    UNIQUE INDEX `rate_limits_scope_keyHash_windowStart_key`(`scope`, `keyHash`, `windowStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

