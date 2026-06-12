-- Rename Stripe-related columns to stripe* prefix for consistency
ALTER TABLE "users" RENAME COLUMN "subscriptionStart" TO "stripeSubscriptionStart";
ALTER TABLE "users" RENAME COLUMN "currentPeriodEnd" TO "stripeCurrentPeriodEnd";
ALTER TABLE "users" RENAME COLUMN "lastStripeSyncAt" TO "stripeLastSyncAt";
ALTER TABLE "users" RENAME COLUMN "subscriptionInterval" TO "stripeSubscriptionInterval";
ALTER TABLE "users" RENAME COLUMN "cancelAtPeriodEnd" TO "stripeCancelAtPeriodEnd";

-- Add stripeSubscriptionStatus — stores the last known Stripe subscription status from webhooks
ALTER TABLE "users" ADD COLUMN "stripeSubscriptionStatus" TEXT;
