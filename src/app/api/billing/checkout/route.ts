import 'server-only'
import { z } from 'zod'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { getCachedSession } from '@/lib/session'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { parseOrFail } from '@/lib/utils/validators'
import { createCheckoutSession, ensureStripeCustomerUserId } from '@/lib/stripe'
import { cancelIncompleteSubscriptionsForCustomer, validateCheckoutEligibility } from '@/lib/billing/checkout/stripe-checkout'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { resolveProAccessBypassingCache } from '@/lib/billing/access/pro-access-resolution'
import { getExistingSubscriptionMessage } from '@/lib/billing/messages/billing-messages'
import { reconcileOrphanStripeSubscriptionForUser } from '@/lib/billing/sync/passive-billing-sync'
import { isAllowedCheckoutPriceId, isStripeCheckoutConfigured } from '@/lib/billing/config/billing-pricing'
import { logger } from '@/lib/infra/pino'
import { getBaseUrl } from '@/lib/utils/url'
import type { BillingRedirectData } from '@/types/billing'

const log = logger.child({ tag: 'api-billing-checkout' })

const checkoutPriceIdSchema = z
  .string()
  .trim()
  .min(1, 'Invalid subscription plan selected.')
  .refine(isAllowedCheckoutPriceId, 'Invalid subscription plan selected.')

export const POST = authenticatedRoute(async (request, _context, { userId }) => {
  const denied = await rateLimitRoute('stripeCheckout', userId)
  if (denied) return denied

  const body = (await request.json().catch(() => null)) as { priceId?: unknown } | null
  const parsed = parseOrFail(checkoutPriceIdSchema, body?.priceId)
  if (!parsed.success) return parsed.response

  if (!isStripeCheckoutConfigured()) {
    log.error('Checkout unavailable — Stripe price IDs are not configured')
    return ApiResponse.INTERNAL_ERROR('Billing is temporarily unavailable. Please contact support.')
  }

  if (await resolveProAccessBypassingCache(userId)) {
    return ApiResponse.CONFLICT('You already have an active subscription. Manage it from Billing settings.')
  }

  const eligibility = await validateCheckoutEligibility(userId, parsed.data)
  if (eligibility.status === 'invalid_price') {
    return ApiResponse.BAD_REQUEST('Invalid subscription plan selected.')
  }
  if (eligibility.status === 'existing_subscription') {
    const linked = await reconcileOrphanStripeSubscriptionForUser(
      userId,
      eligibility.customerId && eligibility.blockingSubscription
        ? { customerId: eligibility.customerId, blockingSubscription: eligibility.blockingSubscription }
        : undefined,
    )
    if (linked) {
      return ApiResponse.OK<BillingRedirectData>({ url: `${getBaseUrl()}/api/billing/checkout-return` })
    }
    return ApiResponse.CONFLICT(getExistingSubscriptionMessage(eligibility.subscriptionStatus))
  }
  if (eligibility.status === 'error') {
    return ApiResponse.INTERNAL_ERROR('Unable to start checkout. Please try again.')
  }

  const session = await getCachedSession()
  const userEmail = session?.user?.email ?? undefined

  try {
    const existingStripeInfo = await getCachedUserStripeInfo(userId)
    const customerId = eligibility.customerId ?? existingStripeInfo?.stripeCustomerId ?? undefined
    if (customerId) {
      const customerLinked = await ensureStripeCustomerUserId(customerId, userId)
      if (!customerLinked) {
        return ApiResponse.CONFLICT('This billing account is linked to another user. Please contact support.')
      }
      await cancelIncompleteSubscriptionsForCustomer(customerId)
    }
    const stripeSession = await createCheckoutSession({
      priceId: parsed.data,
      userId,
      userEmail,
      customerId,
      successUrl: `${getBaseUrl()}/api/billing/checkout-return`,
      cancelUrl: `${getBaseUrl()}/settings?checkout=canceled`,
    })
    if (!stripeSession.url) {
      log.warn({ userId }, 'Stripe checkout session created but URL missing')
      return ApiResponse.INTERNAL_ERROR('Failed to create Stripe session URL')
    }
    log.info({ userId, checkoutSessionId: stripeSession.id }, 'Created checkout session')
    return ApiResponse.OK<BillingRedirectData>({ url: stripeSession.url })
  } catch (err) {
    log.error({ userId, err }, 'Failed to create checkout session')
    return ApiResponse.INTERNAL_ERROR('Unable to start checkout. Please try again.')
  }
})
