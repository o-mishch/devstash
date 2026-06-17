import { authedRoute } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { createCheckoutInput } from '@/lib/api/schemas/billing'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getCachedSession } from '@/lib/session'
import { createCheckoutSession, ensureStripeCustomerUserId, updateStripeCustomerEmail } from '@/lib/infra/stripe'
import { cancelIncompleteSubscriptionsForCustomer, validateCheckoutEligibility } from '@/lib/billing/checkout/stripe-checkout'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { resolveProAccessBypassingCache } from '@/lib/billing/access/pro-access-resolution'
import { getExistingSubscriptionMessage } from '@/lib/billing/messages/billing-messages'
import { reconcileOrphanStripeSubscriptionForUser } from '@/lib/billing/sync/passive-billing-sync'
import { isAllowedCheckoutPriceId, isStripeCheckoutConfigured } from '@/lib/billing/config/billing-pricing'
import { logger } from '@/lib/infra/pino'
import { getBaseUrl } from '@/lib/utils/url'

const checkoutLog = logger.child({ tag: 'api-billing-checkout' })

export const POST = authedRoute({ rateLimit: 'stripeCheckout' }, async ({ userId, request }) => {
  const parsed = parseOr422(createCheckoutInput, await request.json())
  if (!parsed.ok) return parsed.res
  const { priceId } = parsed.data

  if (!isAllowedCheckoutPriceId(priceId)) {
    return problem(400, ErrorMessage.INVALID_SUBSCRIPTION_PLAN)
  }

  if (!isStripeCheckoutConfigured()) {
    checkoutLog.error('Checkout unavailable — Stripe price IDs are not configured')
    return problem(500, 'Billing is temporarily unavailable. Please contact support.')
  }

  if (await resolveProAccessBypassingCache(userId)) {
    return problem(409, 'You already have an active subscription. Manage it from Billing settings.')
  }

  const eligibility = await validateCheckoutEligibility(userId, priceId)
  if (eligibility.status === 'invalid_price') {
    return problem(400, ErrorMessage.INVALID_SUBSCRIPTION_PLAN)
  }
  if (eligibility.status === 'existing_subscription') {
    const linked = await reconcileOrphanStripeSubscriptionForUser(
      userId,
      eligibility.customerId && eligibility.blockingSubscription
        ? { customerId: eligibility.customerId, blockingSubscription: eligibility.blockingSubscription }
        : undefined,
    )
    if (linked) {
      return json({ url: `${getBaseUrl()}/api/billing/checkout-return` })
    }
    return problem(409, getExistingSubscriptionMessage(eligibility.subscriptionStatus))
  }
  if (eligibility.status === 'error') {
    return problem(500, ErrorMessage.CHECKOUT_START_FAILED)
  }

  const session = await getCachedSession()
  const userEmail = session?.user?.email ?? undefined

  try {
    const existingStripeInfo = await getCachedUserStripeInfo(userId)
    let customerId = eligibility.customerId ?? existingStripeInfo?.stripeCustomerId ?? undefined
    if (customerId) {
      const link = await ensureStripeCustomerUserId(customerId, userId)
      if (link === 'foreign') {
        return problem(409, 'This billing account is linked to another user. Please contact support.')
      }
      if (link === 'deleted') {
        // The stored customer was deleted in Stripe — drop the dead id and let checkout recreate one
        // from the email rather than failing with an opaque Stripe error.
        checkoutLog.warn({ userId, customerId }, 'Stored Stripe customer deleted — falling back to customer_email')
        customerId = undefined
      } else {
        // Self-heal any Stripe customer email drift left by a previously failed (swallowed) sync — the
        // update is idempotent, so this keeps invoices/portal/recovery email on the current address.
        if (userEmail) {
          await updateStripeCustomerEmail(customerId, userEmail).catch((err) => {
            checkoutLog.error({ userId, customerId, err }, 'Failed to refresh Stripe customer email at checkout')
          })
        }
        await cancelIncompleteSubscriptionsForCustomer(customerId)
      }
    }
    const stripeSession = await createCheckoutSession({
      priceId,
      userId,
      userEmail,
      customerId,
      successUrl: `${getBaseUrl()}/api/billing/checkout-return`,
      cancelUrl: `${getBaseUrl()}/settings?checkout=canceled`,
    })
    if (!stripeSession.url) {
      checkoutLog.warn({ userId }, 'Stripe checkout session created but URL missing')
      return problem(500, 'Failed to create Stripe session URL')
    }
    checkoutLog.info({ userId, checkoutSessionId: stripeSession.id }, 'Created checkout session')
    return json({ url: stripeSession.url })
  } catch (err) {
    checkoutLog.error({ userId, err }, 'Failed to create checkout session')
    return problem(500, ErrorMessage.CHECKOUT_START_FAILED)
  }
})
