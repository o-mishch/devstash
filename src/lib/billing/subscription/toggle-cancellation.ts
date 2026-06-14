import 'server-only'
import { ApiResponse } from '@/lib/api/api-response'
import { setSubscriptionCancelAtPeriodEnd } from '@/lib/stripe'
import { getCachedLiveSubscriptionState, getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import {
  getFreshVerifiedProAccess,
  markFreshProAccessResolved,
} from '@/lib/billing/access/pro-access-resolution'
import { applyLiveSubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { syncSubscriptionStateForUser } from '@/lib/billing/sync/passive-billing-sync'
import { invalidateBillingCache } from '@/lib/infra/cache'
import { createLogger } from '@/lib/infra/logger'
import type { ApiBody } from '@/types/api'

const log = createLogger('billing-subscription-toggle')

/** Cancel (or reactivate) the signed-in user's subscription at period end. */
export async function toggleSubscriptionCancellation(userId: string, cancel: boolean): Promise<ApiBody<null>> {
  const user = await getCachedUserStripeInfo(userId)
  if (!user?.stripeSubscriptionId) {
    return ApiResponse.BAD_REQUEST('No active subscription found. Please contact support.')
  }

  try {
    await setSubscriptionCancelAtPeriodEnd(user.stripeSubscriptionId, cancel)
    const live = await getCachedLiveSubscriptionState(user.stripeSubscriptionId)
    if (!live) {
      return ApiResponse.INTERNAL_ERROR(`Unable to ${cancel ? 'cancel' : 'reactivate'} subscription. Please try again.`)
    }
    await applyLiveSubscriptionAccessFromStripe(user.stripeSubscriptionId, live, {
      userId,
      customerId: user.stripeCustomerId,
    })
    const isPro = await getFreshVerifiedProAccess(userId)
    markFreshProAccessResolved(userId, isPro)
    invalidateBillingCache(userId)
    log.info(cancel ? 'Canceled subscription' : 'Reactivated subscription', {
      userId,
      subscriptionId: user.stripeSubscriptionId,
    })
    return ApiResponse.OK()
  } catch (err) {
    log.error('Subscription toggle failed — attempting billing sync recovery', { userId, cancel, error: err })
    try {
      await syncSubscriptionStateForUser(userId)
    } catch (syncErr) {
      log.error('Billing sync recovery after subscription toggle failed', { userId, error: syncErr })
    }
    return ApiResponse.INTERNAL_ERROR(
      `Unable to ${cancel ? 'cancel' : 'reactivate'} subscription. Please refresh billing settings and try again.`,
    )
  }
}
