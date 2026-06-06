-- CreateEnum
CREATE TYPE "SubscriptionInterval" AS ENUM ('month', 'year');
-- AlterTable
ALTER TABLE "users"
ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "subscriptionInterval" "SubscriptionInterval";