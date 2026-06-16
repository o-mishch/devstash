import 'server-only'
import { setSubscriptionCancelAtPeriodEnd } from '@/lib/stripe'
import { getCachedLiveSubscriptionState, getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import {
  getFreshVerifiedProAccess,
  markFreshProAccessResolved,
} from '@/lib/billing/access/pro-access-resolution'
import { applyLiveSubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { syncSubscriptionStateForUser } from '@/lib/billing/sync/passive-billing-sync'
import { invalidateBillingCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'billing-subscription-toggle' })

/**
 * Cancel (or reactivate) the signed-in user's subscription at period end. Throws on failure; the
 * billing cancel/reactivate route handlers let the throw surface as a 500.
 */
export async function toggleSubscriptionCancellation(userId: string, cancel: boolean): Promise<void> {
  const user = await getCachedUserStripeInfo(userId)
  if (!user?.stripeSubscriptionId) {
    throw new Error('No active subscription found. Please contact support.')
  }

  // Distinguishes a deliberate failure (already the right response — don't run sync recovery) from
  // an unexpected throw during the Stripe sequence (recover, then surface a generic message).
  let deliberate = false
  try {
    await setSubscriptionCancelAtPeriodEnd(user.stripeSubscriptionId, cancel)
    const live = await getCachedLiveSubscriptionState(user.stripeSubscriptionId)
    if (!live) {
      deliberate = true
      throw new Error(`Unable to ${cancel ? 'cancel' : 'reactivate'} subscription. Please try again.`)
    }
    await applyLiveSubscriptionAccessFromStripe(user.stripeSubscriptionId, live, {
      userId,
      customerId: user.stripeCustomerId,
    })
    const isPro = await getFreshVerifiedProAccess(userId)
    markFreshProAccessResolved(userId, isPro)
    invalidateBillingCache(userId)
    log.info({
      userId,
      subscriptionId: user.stripeSubscriptionId,
    }, cancel ? 'Canceled subscription' : 'Reactivated subscription')
  } catch (err) {
    if (deliberate) throw err
    log.error({ userId, cancel, err }, 'Subscription toggle failed — attempting billing sync recovery')
    try {
      await syncSubscriptionStateForUser(userId)
    } catch (syncErr) {
      log.error({ userId, err: syncErr }, 'Billing sync recovery after subscription toggle failed')
    }
    throw new Error(
      `Unable to ${cancel ? 'cancel' : 'reactivate'} subscription. Please refresh billing settings and try again.`,
    )
  }
}
