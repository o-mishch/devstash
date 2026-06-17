import 'server-only'

import { logger } from '@/lib/infra/pino'
import {
  cancelSubscriptionImmediately,
  deleteStripeCustomer,
  updateStripeCustomerEmail,
} from '@/lib/infra/stripe'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'

const log = logger.child({ tag: 'billing-lifecycle' })

// Syncs the app account email to the linked Stripe customer record. Throws on Stripe failure so the
// resilient wrapper can decide how to handle it (the only caller). Logging lives in the wrapper to
// avoid double-logging the same failure.
async function syncStripeCustomerEmailForUser(userId: string, email: string): Promise<void> {
  const user = await getCachedUserStripeInfo(userId)
  if (!user?.stripeCustomerId) return
  await updateStripeCustomerEmail(user.stripeCustomerId, email)
  log.info({ userId, customerId: user.stripeCustomerId }, 'Synced Stripe customer email after app email change')
}

// Resilient variant for callers whose DB email change is ALREADY committed (and may have spent a
// single-use token) before reaching Stripe: a Stripe outage must not throw out and 500 the request,
// stranding a successful change with no way to retry. Logs and swallows. The drift it leaves behind
// self-heals on the next checkout, which idempotently refreshes the Stripe customer email.
export async function syncStripeCustomerEmailForUserSafe(userId: string, email: string): Promise<void> {
  try {
    await syncStripeCustomerEmailForUser(userId, email)
  } catch (error) {
    log.error({ userId, err: error }, 'Stripe customer email sync failed — change already committed, continuing')
  }
}

/**
 * Cancels Stripe billing before a user account is deleted so subscriptions do not
 * keep charging a removed account.
 */
export async function teardownStripeBillingForUser(userId: string): Promise<void> {
  const user = await getCachedUserStripeInfo(userId)
  if (!user?.stripeCustomerId && !user?.stripeSubscriptionId) return

  if (user.stripeSubscriptionId) {
    try {
      await cancelSubscriptionImmediately(user.stripeSubscriptionId)
      log.info({
        userId,
        subscriptionId: user.stripeSubscriptionId,
      }, 'Canceled Stripe subscription during account deletion')
    } catch (error) {
      log.error({
        userId,
        subscriptionId: user.stripeSubscriptionId,
        err: error,
      }, 'Failed to cancel Stripe subscription during account deletion')
      throw error
    }
  }

  if (user.stripeCustomerId) {
    try {
      await deleteStripeCustomer(user.stripeCustomerId)
      log.info({
        userId,
        customerId: user.stripeCustomerId,
      }, 'Deleted Stripe customer during account deletion')
    } catch (error) {
      log.error({
        userId,
        customerId: user.stripeCustomerId,
        err: error,
      }, 'Failed to delete Stripe customer during account deletion')
      throw error
    }
  }
}
