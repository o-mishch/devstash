import 'server-only'

import type Stripe from 'stripe'
import { Prisma } from '@/generated/prisma'
import { cancelAbandonedSubscription, createStripeCustomer, ensureStripeCustomerUserId } from '@/lib/infra/stripe'
import { checkoutSubscriptionBlocksNewCheckout } from '@/lib/billing/subscription/subscription-access'
import { fetchCheckoutSessionDetails, isStripeResourceMissing, iterateCustomerSubscriptions, listStripeCustomersByEmail } from '@/lib/billing/stripe-api'
import { clearStripeCustomerByCustomerId, linkStripeCustomerToUser } from '@/lib/db/stripe'
import { invalidateBillingCache } from '@/lib/infra/cache'
import { isAllowedCheckoutPriceId } from '@/lib/billing/config/billing-pricing'
import { persistSubscriptionFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'stripe-checkout' })

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
        log.warn({
          customerId: customer.id,
          subscriptionId: blockingSubscription.id,
          requestedUserId: options.userId,
          subscriptionUserId,
        }, 'Skipped Stripe customer with subscription owned by another user')
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
    try {
      const blockingSubscription = await findCheckoutBlockingSubscription(input.stripeCustomerId)
      return {
        customerId: input.stripeCustomerId,
        blockingSubscription,
      }
    } catch (error) {
      // A stored customer id that no longer exists in this Stripe account (deleted, or minted
      // against different credentials after a test↔live switch / data reset) throws
      // resource_missing. Drop the dead id and fall through to email-based recovery instead of
      // hard-failing checkout — the two independent environments then re-converge on the live
      // customer for this email. Any other Stripe error still propagates.
      if (!isStripeResourceMissing(error)) throw error
      log.warn(
        { userId: input.userId, customerId: input.stripeCustomerId },
        'Stored Stripe customer missing — clearing stale id and recovering by email',
      )
      const { userIds } = await clearStripeCustomerByCustomerId(input.stripeCustomerId)
      userIds.forEach((clearedUserId) => invalidateBillingCache(clearedUserId))
    }
  }

  if (!input.email) {
    return { customerId: null, blockingSubscription: null }
  }

  log.info({
    userId: input.userId,
    email: input.email,
  }, 'Recovering Stripe customer by email for checkout eligibility')

  const recovered = await findCheckoutCustomerByEmail(input.email, { userId: input.userId })
  return {
    customerId: recovered.customerId,
    blockingSubscription: recovered.blockingSubscription,
  }
}

export interface ResolveOrCreateStripeCustomerInput {
  userId: string
  email: string
  stripeCustomerId: string | null
}

export interface ResolveOrCreateStripeCustomerResult {
  /** 'ok' → customerId is set; 'foreign' → the customer is linked to a different app user. */
  status: 'ok' | 'foreign'
  customerId?: string
}

/**
 * Returns the ONE Stripe customer id for this user, creating it only if none exists yet — the
 * single entry point checkout uses so a customer is always defined before a Checkout Session.
 *
 * Dedup order (durable → last-resort), so two independent environments sharing one Stripe account
 * converge on the same customer per email instead of duplicating:
 *   1. Stored DB id (self-healed against resource_missing by resolveStripeCustomerForUser — a wrong
 *      or dead id is cleared and recovery continues rather than failing checkout).
 *   2. Existing Stripe customer found by email (customers.list — strongly consistent, unlike
 *      customers.search which lags and would let a racing env miss a just-created customer).
 *   3. Create a new customer with a deterministic idempotency key (collapses the simultaneous race).
 * The resolved id is persisted locally so subsequent checkouts take the fast path.
 */
export async function resolveOrCreateStripeCustomer(
  input: ResolveOrCreateStripeCustomerInput,
): Promise<ResolveOrCreateStripeCustomerResult> {
  const resolved = await resolveStripeCustomerForUser({
    userId: input.userId,
    email: input.email,
    stripeCustomerId: input.stripeCustomerId,
  })

  if (resolved.customerId) {
    // Recovered by email or via the stored id. Tag it with this userId and persist so later
    // checkouts take the fast path. A 'foreign' link (customer owned by another app user) is a
    // genuine conflict the user can't self-resolve — surface it rather than reusing the customer.
    const link = await ensureStripeCustomerUserId(resolved.customerId, input.userId)
    if (link === 'foreign') return { status: 'foreign' }
    if (resolved.customerId !== input.stripeCustomerId) {
      try {
        await linkStripeCustomerToUser(input.userId, resolved.customerId)
      } catch (error) {
        // The Stripe metadata check above passed, but the customer id is already stored on a
        // DIFFERENT app user's row (empty/mismatched metadata + an existing DB link — e.g. a
        // half-finished earlier flow). The unique constraint fires P2002; treat it as the same
        // unresolvable conflict as a foreign metadata link rather than a generic checkout error.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          log.warn(
            { userId: input.userId, customerId: resolved.customerId },
            'Stripe customer already linked to another app user in DB — surfacing as foreign',
          )
          return { status: 'foreign' }
        }
        throw error
      }
      invalidateBillingCache(input.userId)
    }
    return { status: 'ok', customerId: resolved.customerId }
  }

  const customer = await createStripeCustomer({ email: input.email, userId: input.userId })
  await linkStripeCustomerToUser(input.userId, customer.id)
  invalidateBillingCache(input.userId)
  log.info({ userId: input.userId, customerId: customer.id }, 'Created new Stripe customer for checkout')
  return { status: 'ok', customerId: customer.id }
}

/** Cancels stale incomplete subscriptions so a new checkout does not accumulate orphans. */
export async function cancelIncompleteSubscriptionsForCustomer(customerId: string): Promise<void> {
  const incompleteIds: string[] = []
  for await (const subscription of iterateCustomerSubscriptions(customerId)) {
    if (subscription.status === 'incomplete') {
      incompleteIds.push(subscription.id)
    }
  }
  // allSettled (not all): one failed cancel must not abandon the rest — leaving orphans is the exact
  // state this cleanup exists to prevent. Log failures so a persistent orphan is still visible.
  const results = await Promise.allSettled(incompleteIds.map((id) => cancelAbandonedSubscription(id)))
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      log.error({ customerId, subscriptionId: incompleteIds[index], err: result.reason }, 'Failed to cancel incomplete subscription')
    }
  })
}

export async function validateCheckoutEligibility(userId: string, priceId: string): Promise<CheckoutEligibilityResult> {
  if (!isAllowedCheckoutPriceId(priceId)) {
    log.warn({ userId, priceId }, 'Rejected checkout session for invalid Stripe price')
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

    log.warn({
      userId,
      customerId,
      subscriptionId: blockingSubscription.id,
      status: blockingSubscription.status,
      recoveredByEmail: !user.stripeCustomerId,
    }, 'Rejected checkout because customer already has an existing subscription')

    return {
      status: 'existing_subscription',
      customerId,
      subscriptionId: blockingSubscription.id,
      subscriptionStatus: blockingSubscription.status,
      blockingSubscription,
    }
  } catch (error) {
    log.error({ userId, err: error }, 'Failed to validate existing subscription before checkout')
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
