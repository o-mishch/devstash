-- CreateEnum
CREATE TYPE "SubscriptionInterval" AS ENUM ('month', 'year');
-- AlterTable
ALTER TABLE "User"
ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "subscriptionInterval" "SubscriptionInterval";