'use server'

import { redirect } from 'next/navigation'
import {
  createCheckoutSession,
  createPortalSession,
  ensureStripeCustomerUserId,
  setSubscriptionCancelAtPeriodEnd,
} from '@/lib/stripe'
import { cancelIncompleteSubscriptionsForCustomer } from '@/lib/billing/checkout/stripe-checkout'
import {
  getCachedLiveSubscriptionState,
  getCachedUserStripeInfo,
} from '@/lib/billing/sync/user-billing-state'
import {
  getFreshVerifiedProAccess,
  markFreshProAccessResolved,
  resolveProAccessBypassingCache,
} from '@/lib/billing/access/pro-access-resolution'
import { applyLiveSubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { getExistingSubscriptionMessage } from '@/lib/billing/messages/billing-messages'
import { validateCheckoutEligibility } from '@/lib/billing/checkout/stripe-checkout'
import { reconcileOrphanStripeSubscriptionForUser, syncSubscriptionStateForUser } from '@/lib/billing/sync/passive-billing-sync'
import { isAllowedCheckoutPriceId, isStripeCheckoutConfigured } from '@/lib/billing/config/billing-pricing'
import { invalidateBillingCache } from '@/lib/infra/cache'
import { requireAuthSessionWithRateLimit, withAuthAndRateLimit } from '@/lib/session'
import { ApiResponse } from '@/lib/api'
import { createLogger } from '@/lib/infra/logger'
import { getBaseUrl } from '@/lib/utils/url'
import { parseOrFail } from '@/lib/utils/validators'
import type { ApiBody } from '@/types/api'
import { z } from 'zod'

const log = createLogger('stripe-actions')

/** Error payload from checkout/portal actions. Success paths call redirect() and never return. */
export type StripeRedirectActionError = ApiBody<null>

const checkoutPriceIdSchema = z
  .string()
  .trim()
  .min(1, 'Invalid subscription plan selected.')
  .refine(isAllowedCheckoutPriceId, 'Invalid subscription plan selected.')

/** Redirect actions use requireAuthSessionWithRateLimit; form-return actions use withAuthAndRateLimit. */
async function toggleCancelSubscription(cancel: boolean): Promise<ApiBody<null>> {
  return withAuthAndRateLimit('stripeSubscription', async ({ userId }) => {
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
  }, cancel ? 'cancelSubscription' : 'reactivateSubscription')
}

export async function createCheckoutSessionFormAction(
  prevState: StripeRedirectActionError | null,
  formData: FormData,
): Promise<StripeRedirectActionError> {
  void prevState
  const result = parseOrFail(checkoutPriceIdSchema, formData.get('priceId'))
  if (!result.success) return result.response
  return createCheckoutSessionAction(result.data)
}

export async function createCheckoutSessionAction(
  priceId: string,
): Promise<StripeRedirectActionError> {
  const authResult = await requireAuthSessionWithRateLimit('stripeCheckout')
  if (!authResult.ok) return authResult.response
  const auth = authResult.session

  const parsed = parseOrFail(checkoutPriceIdSchema, priceId)
  if (!parsed.success) return parsed.response

  if (!isStripeCheckoutConfigured()) {
    log.error('Checkout unavailable — Stripe price IDs are not configured')
    return ApiResponse.INTERNAL_ERROR('Billing is temporarily unavailable. Please contact support.')
  }

  if (await resolveProAccessBypassingCache(auth.userId)) {
    return ApiResponse.CONFLICT('You already have an active subscription. Manage it from Billing settings.')
  }

  const eligibility = await validateCheckoutEligibility(auth.userId, parsed.data)
  if (eligibility.status === 'invalid_price') {
    return ApiResponse.BAD_REQUEST('Invalid subscription plan selected.')
  }
  if (eligibility.status === 'existing_subscription') {
    const linked = await reconcileOrphanStripeSubscriptionForUser(
      auth.userId,
      eligibility.customerId && eligibility.blockingSubscription
        ? { customerId: eligibility.customerId, blockingSubscription: eligibility.blockingSubscription }
        : undefined,
    )
    if (linked) {
      redirect(`${getBaseUrl()}/api/billing/checkout-return`)
    }
    return ApiResponse.CONFLICT(getExistingSubscriptionMessage(eligibility.subscriptionStatus))
  }
  if (eligibility.status === 'error') {
    return ApiResponse.INTERNAL_ERROR('Unable to start checkout. Please try again.')
  }

  let checkoutUrl: string
  let checkoutSessionId: string
  try {
    const existingStripeInfo = await getCachedUserStripeInfo(auth.userId)
    const customerId = eligibility.customerId ?? existingStripeInfo?.stripeCustomerId ?? undefined
    if (customerId) {
      const customerLinked = await ensureStripeCustomerUserId(customerId, auth.userId)
      if (!customerLinked) {
        return ApiResponse.CONFLICT('This billing account is linked to another user. Please contact support.')
      }
      await cancelIncompleteSubscriptionsForCustomer(customerId)
    }
    const stripeSession = await createCheckoutSession({
      priceId: parsed.data,
      userId: auth.userId,
      userEmail: auth.email ?? undefined,
      customerId,
      successUrl: `${getBaseUrl()}/api/billing/checkout-return`,
      cancelUrl: `${getBaseUrl()}/settings?checkout=canceled`,
    })
    if (!stripeSession.url) {
      log.warn('Stripe checkout session created but URL missing', { userId: auth.userId })
      return ApiResponse.INTERNAL_ERROR('Failed to create Stripe session URL')
    }
    checkoutUrl = stripeSession.url
    checkoutSessionId = stripeSession.id
  } catch (err) {
    log.error('Failed to create checkout session', { userId: auth.userId, error: err })
    return ApiResponse.INTERNAL_ERROR('Unable to start checkout. Please try again.')
  }

  log.info('Created checkout session', { userId: auth.userId, checkoutSessionId })
  redirect(checkoutUrl)
}

export async function createPortalSessionAction(
  prevState: StripeRedirectActionError | null,
  formData: FormData,
): Promise<StripeRedirectActionError> {
  void prevState
  void formData
  const authResult = await requireAuthSessionWithRateLimit('stripePortal')
  if (!authResult.ok) return authResult.response
  const auth = authResult.session

  const user = await getCachedUserStripeInfo(auth.userId)
  if (!user?.stripeCustomerId) {
    log.warn('Portal access attempted but no stripeCustomerId', { userId: auth.userId })
    return ApiResponse.BAD_REQUEST('No subscription found. Please contact support.')
  }

  let portalUrl: string
  try {
    const portalSession = await createPortalSession(user.stripeCustomerId, `${getBaseUrl()}/settings`)
    if (!portalSession.url) {
      log.warn('Stripe portal session created but URL missing', { userId: auth.userId })
      return ApiResponse.INTERNAL_ERROR('Failed to create Portal session URL')
    }
    portalUrl = portalSession.url
  } catch (err) {
    log.error('Failed to create portal session', { userId: auth.userId, error: err })
    return ApiResponse.INTERNAL_ERROR('Unable to open billing portal. Please try again.')
  }

  log.info('Created portal session', { userId: auth.userId })
  redirect(portalUrl)
}

export async function cancelSubscriptionAction(
  prevState: ApiBody<null> | null,
  formData: FormData,
): Promise<ApiBody<null>> {
  void prevState
  void formData
  return toggleCancelSubscription(true)
}

export async function reactivateSubscriptionAction(
  prevState: ApiBody<null> | null,
  formData: FormData,
): Promise<ApiBody<null>> {
  void prevState
  void formData
  return toggleCancelSubscription(false)
}
