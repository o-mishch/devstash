import 'server-only'

import { logger } from '@/lib/infra/pino'
import {
  cancelSubscriptionImmediately,
  deleteStripeCustomer,
  updateStripeCustomerEmail,
} from '@/lib/stripe'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'

const log = logger.child({ tag: 'billing-lifecycle' })

/** Syncs the app account email to the linked Stripe customer record. */
export async function syncStripeCustomerEmailForUser(userId: string, email: string): Promise<void> {
  const user = await getCachedUserStripeInfo(userId)
  if (!user?.stripeCustomerId) return

  try {
    await updateStripeCustomerEmail(user.stripeCustomerId, email)
    log.info({
      userId,
      customerId: user.stripeCustomerId,
    }, 'Synced Stripe customer email after app email change')
  } catch (error) {
    log.error({
      userId,
      customerId: user.stripeCustomerId,
      err: error,
    }, 'Failed to sync Stripe customer email after app email change')
    throw error
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
