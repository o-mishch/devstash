import 'server-only'
import { ORPCError } from '@orpc/server'
import { authed } from '../orpc'
import { enforceRateLimit } from '../middleware'
import { ErrorMessage } from '../error-messages'
import { getCachedSession } from '@/lib/session'
import { createCheckoutSession, createPortalSession, ensureStripeCustomerUserId } from '@/lib/stripe'
import { cancelIncompleteSubscriptionsForCustomer, validateCheckoutEligibility } from '@/lib/billing/checkout/stripe-checkout'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { resolveProAccessBypassingCache } from '@/lib/billing/access/pro-access-resolution'
import { getExistingSubscriptionMessage } from '@/lib/billing/messages/billing-messages'
import { reconcileOrphanStripeSubscriptionForUser } from '@/lib/billing/sync/passive-billing-sync'
import { isAllowedCheckoutPriceId, isStripeCheckoutConfigured } from '@/lib/billing/config/billing-pricing'
import { toggleSubscriptionCancellation } from '@/lib/billing/subscription/toggle-cancellation'
import { logger } from '@/lib/infra/pino'
import { getBaseUrl } from '@/lib/utils/url'

const checkoutLog = logger.child({ tag: 'api-billing-checkout' })
const portalLog = logger.child({ tag: 'api-billing-portal' })

export const billingRouter = {
  createCheckout: authed.billing.createCheckout.handler(async ({ input, context }) => {
    const { userId } = context
    await enforceRateLimit('stripeCheckout', userId, context.resHeaders)

    if (!isAllowedCheckoutPriceId(input.priceId)) {
      throw new ORPCError('BAD_REQUEST', { message: ErrorMessage.INVALID_SUBSCRIPTION_PLAN })
    }

    if (!isStripeCheckoutConfigured()) {
      checkoutLog.error('Checkout unavailable — Stripe price IDs are not configured')
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Billing is temporarily unavailable. Please contact support.' })
    }

    if (await resolveProAccessBypassingCache(userId)) {
      throw new ORPCError('CONFLICT', { message: 'You already have an active subscription. Manage it from Billing settings.' })
    }

    const eligibility = await validateCheckoutEligibility(userId, input.priceId)
    if (eligibility.status === 'invalid_price') {
      throw new ORPCError('BAD_REQUEST', { message: ErrorMessage.INVALID_SUBSCRIPTION_PLAN })
    }
    if (eligibility.status === 'existing_subscription') {
      const linked = await reconcileOrphanStripeSubscriptionForUser(
        userId,
        eligibility.customerId && eligibility.blockingSubscription
          ? { customerId: eligibility.customerId, blockingSubscription: eligibility.blockingSubscription }
          : undefined,
      )
      if (linked) {
        return { url: `${getBaseUrl()}/api/billing/checkout-return` }
      }
      throw new ORPCError('CONFLICT', { message: getExistingSubscriptionMessage(eligibility.subscriptionStatus) })
    }
    if (eligibility.status === 'error') {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: ErrorMessage.CHECKOUT_START_FAILED })
    }

    const session = await getCachedSession()
    const userEmail = session?.user?.email ?? undefined

    try {
      const existingStripeInfo = await getCachedUserStripeInfo(userId)
      const customerId = eligibility.customerId ?? existingStripeInfo?.stripeCustomerId ?? undefined
      if (customerId) {
        const customerLinked = await ensureStripeCustomerUserId(customerId, userId)
        if (!customerLinked) {
          throw new ORPCError('CONFLICT', { message: 'This billing account is linked to another user. Please contact support.' })
        }
        await cancelIncompleteSubscriptionsForCustomer(customerId)
      }
      const stripeSession = await createCheckoutSession({
        priceId: input.priceId,
        userId,
        userEmail,
        customerId,
        successUrl: `${getBaseUrl()}/api/billing/checkout-return`,
        cancelUrl: `${getBaseUrl()}/settings?checkout=canceled`,
      })
      if (!stripeSession.url) {
        checkoutLog.warn({ userId }, 'Stripe checkout session created but URL missing')
        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to create Stripe session URL' })
      }
      checkoutLog.info({ userId, checkoutSessionId: stripeSession.id }, 'Created checkout session')
      return { url: stripeSession.url }
    } catch (err) {
      if (err instanceof ORPCError) throw err
      checkoutLog.error({ userId, err }, 'Failed to create checkout session')
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: ErrorMessage.CHECKOUT_START_FAILED })
    }
  }),

  createPortal: authed.billing.createPortal.handler(async ({ context }) => {
    const { userId } = context
    await enforceRateLimit('stripePortal', userId, context.resHeaders)

    const user = await getCachedUserStripeInfo(userId)
    if (!user?.stripeCustomerId) {
      portalLog.warn({ userId }, 'Portal access attempted but no stripeCustomerId')
      throw new ORPCError('BAD_REQUEST', { message: 'No subscription found. Please contact support.' })
    }

    try {
      const portalSession = await createPortalSession(user.stripeCustomerId, `${getBaseUrl()}/settings`)
      if (!portalSession.url) {
        portalLog.warn({ userId }, 'Stripe portal session created but URL missing')
        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to create Portal session URL' })
      }
      portalLog.info({ userId }, 'Created portal session')
      return { url: portalSession.url }
    } catch (err) {
      if (err instanceof ORPCError) throw err
      portalLog.error({ userId, err }, 'Failed to create portal session')
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Unable to open billing portal. Please try again.' })
    }
  }),

  cancelSubscription: authed.billing.cancelSubscription.handler(async ({ context }) => {
    await enforceRateLimit('stripeSubscription', context.userId, context.resHeaders)
    await toggleSubscriptionCancellation(context.userId, true)
  }),

  reactivateSubscription: authed.billing.reactivateSubscription.handler(async ({ context }) => {
    await enforceRateLimit('stripeSubscription', context.userId, context.resHeaders)
    await toggleSubscriptionCancellation(context.userId, false)
  }),
}
