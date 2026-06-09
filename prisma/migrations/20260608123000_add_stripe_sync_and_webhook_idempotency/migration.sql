-- AlterTable
ALTER TABLE "users"
ADD COLUMN "lastStripeSyncAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "StripeWebhookEventStatus" AS ENUM ('processing', 'processed');

-- CreateTable
CREATE TABLE "stripe_webhook_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "StripeWebhookEventStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stripe_webhook_events_status_createdAt_idx" ON "stripe_webhook_events"("status", "createdAt");
