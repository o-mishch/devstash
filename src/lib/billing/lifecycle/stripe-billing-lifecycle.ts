import 'server-only'

import { createLogger } from '@/lib/infra/logger'
import {
  cancelSubscriptionImmediately,
  deleteStripeCustomer,
  updateStripeCustomerEmail,
} from '@/lib/stripe'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'

const log = createLogger('billing-lifecycle')

/** Syncs the app account email to the linked Stripe customer record. */
export async function syncStripeCustomerEmailForUser(userId: string, email: string): Promise<void> {
  const user = await getCachedUserStripeInfo(userId)
  if (!user?.stripeCustomerId) return

  try {
    await updateStripeCustomerEmail(user.stripeCustomerId, email)
    log.info('Synced Stripe customer email after app email change', {
      userId,
      customerId: user.stripeCustomerId,
    })
  } catch (error) {
    log.error('Failed to sync Stripe customer email after app email change', {
      userId,
      customerId: user.stripeCustomerId,
      error,
    })
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
      log.info('Canceled Stripe subscription during account deletion', {
        userId,
        subscriptionId: user.stripeSubscriptionId,
      })
    } catch (error) {
      log.error('Failed to cancel Stripe subscription during account deletion', {
        userId,
        subscriptionId: user.stripeSubscriptionId,
        error,
      })
      throw error
    }
  }

  if (user.stripeCustomerId) {
    try {
      await deleteStripeCustomer(user.stripeCustomerId)
      log.info('Deleted Stripe customer during account deletion', {
        userId,
        customerId: user.stripeCustomerId,
      })
    } catch (error) {
      log.error('Failed to delete Stripe customer during account deletion', {
        userId,
        customerId: user.stripeCustomerId,
        error,
      })
      throw error
    }
  }
}
