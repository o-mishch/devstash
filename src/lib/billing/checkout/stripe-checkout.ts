import 'server-only'

import type Stripe from 'stripe'
import { cancelAbandonedSubscription } from '@/lib/stripe'
import { checkoutSubscriptionBlocksNewCheckout } from '@/lib/billing/subscription/subscription-access'
import { fetchCheckoutSessionDetails, iterateCustomerSubscriptions, listStripeCustomersByEmail } from '@/lib/billing/stripe-api'
import { isAllowedCheckoutPriceId } from '@/lib/billing/config/billing-pricing'
import { persistSubscriptionFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('stripe-checkout')

export interface CheckoutEligibilityResult {
  status: 'ok' | 'invalid_price' | 'existing_subscription' | 'error'
  customerId?: string
  subscriptionId?: string
  subscriptionStatus?: Stripe.Subscription.Status
  blockingSubscription?: Stripe.Subscription
}

export interface CheckoutFinalizationResult {
  status: 'ok' | 'invalid_session' | 'forbidden' | 'unavailable'
  grantsAccess?: boolean
}

export interface CheckoutCustomerResolution {
  blockingSubscription: Stripe.Subscription | null
  customerId: string | null
}

export interface FindCheckoutCustomerOptions {
  preferredCustomerId?: string
  userId?: string
}

export async function findCheckoutBlockingSubscription(customerId: string): Promise<Stripe.Subscription | null> {
  for await (const subscription of iterateCustomerSubscriptions(customerId)) {
    if (checkoutSubscriptionBlocksNewCheckout(subscription.status)) {
      return subscription
    }
  }

  return null
}

function customerMetadataMatchesUser(customer: Stripe.Customer, userId: string): boolean {
  return typeof customer.metadata?.userId === 'string' && customer.metadata.userId === userId
}

function compareCustomersForCheckout(
  a: Stripe.Customer,
  b: Stripe.Customer,
  options: FindCheckoutCustomerOptions,
): number {
  const preferredId = options.preferredCustomerId
  if (preferredId) {
    const aPreferred = a.id === preferredId
    const bPreferred = b.id === preferredId
    if (aPreferred && !bPreferred) return -1
    if (!aPreferred && bPreferred) return 1
  }

  const userId = options.userId
  if (userId) {
    const aMatches = customerMetadataMatchesUser(a, userId)
    const bMatches = customerMetadataMatchesUser(b, userId)
    if (aMatches && !bMatches) return -1
    if (!aMatches && bMatches) return 1
  }

  return 0
}

function rankCustomersForCheckout(
  customers: Stripe.Customer[],
  options?: FindCheckoutCustomerOptions,
): Stripe.Customer[] {
  if (!options?.preferredCustomerId && !options?.userId) return customers
  return [...customers].sort((a, b) => compareCustomersForCheckout(a, b, options))
}

export async function findCheckoutCustomerByEmail(
  email: string,
  options?: FindCheckoutCustomerOptions,
): Promise<CheckoutCustomerResolution> {
  const rankedCustomers = rankCustomersForCheckout(
    await listStripeCustomersByEmail(email),
    options,
  )
  let fallbackCustomerId: string | null = null

  for (const customer of rankedCustomers) {
    const ownedByUser = !options?.userId || customerMetadataMatchesUser(customer, options.userId)
    if (!ownedByUser) continue

    fallbackCustomerId ??= customer.id

    const blockingSubscription = await findCheckoutBlockingSubscription(customer.id)
    if (blockingSubscription) {
      const subscriptionUserId = typeof blockingSubscription.metadata?.userId === 'string'
        ? blockingSubscription.metadata.userId
        : null
      if (options?.userId && subscriptionUserId && subscriptionUserId !== options.userId) {
        log.warn('Skipped Stripe customer with subscription owned by another user', {
          customerId: customer.id,
          subscriptionId: blockingSubscription.id,
          requestedUserId: options.userId,
          subscriptionUserId,
        })
        continue
      }
      return {
        blockingSubscription,
        customerId: customer.id,
      }
    }
  }

  return {
    blockingSubscription: null,
    customerId: fallbackCustomerId,
  }
}

export interface ResolvedStripeCustomer {
  customerId: string | null
  blockingSubscription: Stripe.Subscription | null
}

export interface ResolveStripeCustomerInput {
  userId: string
  email: string | null
  stripeCustomerId: string | null
}

/** Resolves the Stripe customer (and any checkout-blocking subscription) for a local user. */
export async function resolveStripeCustomerForUser(
  input: ResolveStripeCustomerInput,
): Promise<ResolvedStripeCustomer> {
  if (input.stripeCustomerId) {
    const blockingSubscription = await findCheckoutBlockingSubscription(input.stripeCustomerId)
    return {
      customerId: input.stripeCustomerId,
      blockingSubscription,
    }
  }

  if (!input.email) {
    return { customerId: null, blockingSubscription: null }
  }

  log.info('Recovering Stripe customer by email for checkout eligibility', {
    userId: input.userId,
    email: input.email,
  })

  const recovered = await findCheckoutCustomerByEmail(input.email, { userId: input.userId })
  return {
    customerId: recovered.customerId,
    blockingSubscription: recovered.blockingSubscription,
  }
}

/** Cancels stale incomplete subscriptions so a new checkout does not accumulate orphans. */
export async function cancelIncompleteSubscriptionsForCustomer(customerId: string): Promise<void> {
  for await (const subscription of iterateCustomerSubscriptions(customerId)) {
    if (subscription.status === 'incomplete') {
      await cancelAbandonedSubscription(subscription.id)
    }
  }
}

export async function validateCheckoutEligibility(userId: string, priceId: string): Promise<CheckoutEligibilityResult> {
  if (!isAllowedCheckoutPriceId(priceId)) {
    log.warn('Rejected checkout session for invalid Stripe price', { userId, priceId })
    return { status: 'invalid_price' }
  }

  try {
    const user = await getCachedUserStripeInfo(userId)
    if (!user) return { status: 'ok' }

    const { customerId, blockingSubscription } = await resolveStripeCustomerForUser({
      userId,
      email: user.email,
      stripeCustomerId: user.stripeCustomerId,
    })

    if (!customerId) return { status: 'ok' }

    if (!blockingSubscription) {
      return { status: 'ok', customerId }
    }

    log.warn('Rejected checkout because customer already has an existing subscription', {
      userId,
      customerId,
      subscriptionId: blockingSubscription.id,
      status: blockingSubscription.status,
      recoveredByEmail: !user.stripeCustomerId,
    })

    return {
      status: 'existing_subscription',
      customerId,
      subscriptionId: blockingSubscription.id,
      subscriptionStatus: blockingSubscription.status,
      blockingSubscription,
    }
  } catch (error) {
    log.error('Failed to validate existing subscription before checkout', { userId, error })
    return { status: 'error' }
  }
}

export async function finalizeCheckoutSessionForUser(userId: string, sessionId: string): Promise<CheckoutFinalizationResult> {
  const session = await fetchCheckoutSessionDetails(sessionId)
  if (!session) return { status: 'unavailable' }
  if (!session.subscriptionId) return { status: 'invalid_session' }
  if (session.userId !== userId) return { status: 'forbidden' }

  const persistResult = await persistSubscriptionFromStripe(
    userId,
    session.subscriptionId,
    session.customerId,
    false,
    session.paymentStatus
  )

  if (!persistResult.persisted) return { status: 'unavailable' }
  return { status: 'ok', grantsAccess: persistResult.grantsAccess }
}
