ALTER TABLE "users" ADD COLUMN "subscriptionStart" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "proExpiredAt" TIMESTAMP(3);
