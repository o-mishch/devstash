import 'server-only'
import { ORPCError } from '@orpc/server'
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

/** Cancel (or reactivate) the signed-in user's subscription at period end. Throws ORPCError on failure. */
export async function toggleSubscriptionCancellation(userId: string, cancel: boolean): Promise<void> {
  const user = await getCachedUserStripeInfo(userId)
  if (!user?.stripeSubscriptionId) {
    throw new ORPCError('BAD_REQUEST', { message: 'No active subscription found. Please contact support.' })
  }

  try {
    await setSubscriptionCancelAtPeriodEnd(user.stripeSubscriptionId, cancel)
    const live = await getCachedLiveSubscriptionState(user.stripeSubscriptionId)
    if (!live) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: `Unable to ${cancel ? 'cancel' : 'reactivate'} subscription. Please try again.` })
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
    // A deliberate ORPCError (e.g. missing live state) is already the right response — re-throw it.
    if (err instanceof ORPCError) throw err
    log.error({ userId, cancel, err }, 'Subscription toggle failed — attempting billing sync recovery')
    try {
      await syncSubscriptionStateForUser(userId)
    } catch (syncErr) {
      log.error({ userId, err: syncErr }, 'Billing sync recovery after subscription toggle failed')
    }
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: `Unable to ${cancel ? 'cancel' : 'reactivate'} subscription. Please refresh billing settings and try again.`,
    })
  }
}
