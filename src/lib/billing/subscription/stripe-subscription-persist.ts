import 'server-only'

import type Stripe from 'stripe'
import { createLogger } from '@/lib/infra/logger'
import {
  fetchSubscriptionDetails,
  getIntervalFromSub,
  getPrimarySubscriptionItem,
  getStripeCustomerId,
  type LiveSubscriptionState,
  type StripeSubscriptionDetails,
} from '@/lib/billing/stripe-api'
import type { SubscriptionInterval } from '@/generated/prisma'
import {
  isSubscriptionCanceling,
  shouldDeferPeriodEndToInvoicePaid,
  shouldGrantCheckoutProAccess,
  subscriptionHasProAccess,
  subscriptionShouldClearLocalLink,
} from '@/lib/billing/subscription/subscription-access'
import { getStripeEventDescription } from '@/lib/billing/config/billing-config'
import { getUserIdsByStripeSubscriptionId } from '@/lib/db/stripe'
import { fromStripeTs } from '@/lib/billing/stripe-utils'
import {
  clearStripeSubscriptionBySubId,
  resolveAppUserIdForSubscription,
  updateSubscriptionState,
  updateUserStripeSubscription,
} from '@/lib/billing/subscription/subscription-state'
import { invalidateBillingCache, invalidateStripeSubscriptionCache } from '@/lib/infra/cache'

const log = createLogger('stripe-subscription')

export interface ApplySubscriptionStateParams {
  subscriptionId: string
  isPro: boolean
  stripeSubscriptionStatus?: string | null
  currentPeriodEnd?: Date | null
  cancelAtPeriodEnd?: boolean
  subscriptionInterval?: SubscriptionInterval
  userId?: string | null
  customerId?: string | null
  subscriptionStart?: Date
}

export interface ApplySubscriptionStateResult {
  rowsUpdated: number
}

/** Updates local subscription state by Stripe subscription ID, backfilling via userId when missing. */
export async function applySubscriptionStateWithBackfill(
  params: ApplySubscriptionStateParams,
): Promise<ApplySubscriptionStateResult> {
  const {
    subscriptionId,
    isPro,
    stripeSubscriptionStatus,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    subscriptionInterval,
    userId: inputUserId,
    customerId,
    subscriptionStart,
  } = params

  const userId = inputUserId ?? (customerId
    ? await resolveAppUserIdForSubscription({ customerId, subscriptionUserId: inputUserId })
    : null)

  const updateResult = await updateSubscriptionState(subscriptionId, {
    isPro,
    ...(stripeSubscriptionStatus !== undefined && { stripeSubscriptionStatus }),
    ...(cancelAtPeriodEnd !== undefined && { stripeCancelAtPeriodEnd: cancelAtPeriodEnd }),
    ...(currentPeriodEnd !== undefined && { stripeCurrentPeriodEnd: currentPeriodEnd }),
    ...(subscriptionInterval && { stripeSubscriptionInterval: subscriptionInterval }),
    stripeLastSyncAt: new Date(),
  })

  if (updateResult.count === 0 && userId && customerId) {
    await updateUserStripeSubscription(userId, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      isPro,
      ...(stripeSubscriptionStatus !== undefined && { stripeSubscriptionStatus }),
      ...(subscriptionStart && { stripeSubscriptionStart: subscriptionStart }),
      ...(currentPeriodEnd !== undefined && { stripeCurrentPeriodEnd: currentPeriodEnd }),
      ...(subscriptionInterval && { stripeSubscriptionInterval: subscriptionInterval }),
      ...(cancelAtPeriodEnd !== undefined && { stripeCancelAtPeriodEnd: cancelAtPeriodEnd }),
      stripeLastSyncAt: new Date(),
    })
    return { rowsUpdated: 1 }
  }

  return { rowsUpdated: updateResult.count }
}

export type SubscriptionAccessApplyOutcome = 'cleared' | 'revoked' | 'updated' | 'unchanged'

export interface PersistSubscriptionResult {
  persisted: boolean
  grantsAccess: boolean
  outcome: SubscriptionAccessApplyOutcome | null
}

export interface ApplySubscriptionAccessParams extends Omit<ApplySubscriptionStateParams, 'isPro'> {
  status: Stripe.Subscription.Status | null
  missingFromStripe?: boolean
  /** When set, used instead of deriving access from `status` (checkout fulfillment). */
  grantsAccess?: boolean
}

export interface LiveSubscriptionAccessContext {
  userId?: string | null
  customerId?: string | null
}

/** Applies resolved Stripe subscription access to the local database. */
export async function applySubscriptionAccessFromStripe(
  params: ApplySubscriptionAccessParams,
): Promise<SubscriptionAccessApplyOutcome> {
  const {
    subscriptionId,
    status,
    missingFromStripe = false,
    grantsAccess: explicitGrantsAccess,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    subscriptionInterval,
    userId,
    customerId,
    subscriptionStart,
  } = params

  const grantsAccess = explicitGrantsAccess ?? subscriptionHasProAccess(status)
  if (missingFromStripe || (!grantsAccess && subscriptionShouldClearLocalLink(status))) {
    await clearStripeSubscriptionBySubId(subscriptionId, currentPeriodEnd ?? undefined)
    invalidateStripeSubscriptionCache(subscriptionId)
    if (userId) invalidateBillingCache(userId)
    return 'cleared'
  }

  const { rowsUpdated } = await applySubscriptionStateWithBackfill({
    subscriptionId,
    isPro: grantsAccess,
    stripeSubscriptionStatus: status,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    subscriptionInterval,
    userId,
    customerId,
    subscriptionStart,
  })

  invalidateStripeSubscriptionCache(subscriptionId)
  if (userId) invalidateBillingCache(userId)

  if (!grantsAccess) return rowsUpdated > 0 ? 'revoked' : 'unchanged'
  return rowsUpdated > 0 ? 'updated' : 'unchanged'
}

export async function applyLiveSubscriptionAccessFromStripe(
  subscriptionId: string,
  live: LiveSubscriptionState,
  context?: LiveSubscriptionAccessContext,
): Promise<SubscriptionAccessApplyOutcome> {
  return applySubscriptionAccessFromStripe({
    subscriptionId,
    status: live.status,
    missingFromStripe: !live.exists,
    currentPeriodEnd: live.currentPeriodEnd,
    cancelAtPeriodEnd: live.cancelAtPeriodEnd,
    subscriptionInterval: live.interval ?? undefined,
    userId: context?.userId,
    customerId: context?.customerId,
  })
}

export async function persistSubscriptionFromStripe(
  userId: string,
  subscriptionId: string,
  fallbackCustomerId: string | null,
  forceActivate: boolean,
  paymentStatus: Stripe.Checkout.Session['payment_status'] | null,
): Promise<PersistSubscriptionResult> {
  const subscription = await fetchSubscriptionDetails(subscriptionId)
  if (!subscription) {
    log.warn('Failed to retrieve subscription details', { userId, subscriptionId })
    return { persisted: false, grantsAccess: false, outcome: null }
  }

  const customerId = subscription.customerId ?? fallbackCustomerId
  if (!customerId) {
    log.warn('Failed to persist subscription because Stripe customer ID was missing', { userId, subscriptionId })
    return { persisted: false, grantsAccess: false, outcome: null }
  }

  const grantsAccess = shouldGrantCheckoutProAccess(
    paymentStatus,
    subscription.status,
    forceActivate,
  )

  const outcome = await applySubscriptionAccessFromStripe({
    subscriptionId,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    subscriptionInterval: subscription.interval,
    userId,
    customerId,
    subscriptionStart: subscription.startDate,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    grantsAccess,
  })

  if (outcome === 'cleared') {
    log.warn('Failed to persist checkout subscription because Stripe status cleared the local link', {
      userId,
      subscriptionId,
      paymentStatus: paymentStatus ?? 'unknown',
      status: subscription.status,
      outcome,
    })
    return { persisted: false, grantsAccess: false, outcome: 'cleared' }
  }

  const eventType = forceActivate ? 'checkout.session.async_payment_succeeded' : 'checkout.session.completed'
  log.info(
    eventType,
    {
      userId,
      subscriptionId,
      paymentStatus: paymentStatus ?? 'unknown',
      status: subscription.status,
      grantedAccess: grantsAccess,
      interval: subscription.interval ?? 'unknown',
      startedAt: subscription.startDate.toISOString(),
      outcome,
    },
    getStripeEventDescription(eventType)
  )

  return { persisted: true, grantsAccess, outcome }
}

export async function reconcileSubscriptionById(
  subscriptionId: string,
): Promise<StripeSubscriptionDetails | null> {
  const details = await fetchSubscriptionDetails(subscriptionId)
  if (!details) return null

  const userId = await resolveAppUserIdForSubscription({
    customerId: details.customerId,
    subscriptionUserId: details.userId,
  })

  await applySubscriptionAccessFromStripe({
    subscriptionId,
    status: details.status,
    currentPeriodEnd: details.currentPeriodEnd,
    subscriptionInterval: details.interval,
    userId,
    customerId: details.customerId,
    subscriptionStart: details.startDate,
    cancelAtPeriodEnd: details.cancelAtPeriodEnd,
  })

  return details
}

export const SUBSCRIPTION_UPSERT_SOURCE_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.updated',
] as const

export type SubscriptionUpsertSourceEvent = (typeof SUBSCRIPTION_UPSERT_SOURCE_EVENTS)[number]

const SUBSCRIPTION_UPSERT_EVENT_SET = new Set<string>(SUBSCRIPTION_UPSERT_SOURCE_EVENTS)

export function isSubscriptionUpsertEvent(
  eventType: string,
): eventType is SubscriptionUpsertSourceEvent {
  return SUBSCRIPTION_UPSERT_EVENT_SET.has(eventType)
}

export async function upsertSubscriptionStateFromObject(
  subscription: Stripe.Subscription,
  sourceEvent: SubscriptionUpsertSourceEvent,
): Promise<void> {
  const periodEnd = getPrimarySubscriptionItem(subscription)?.current_period_end
  const periodEndDate = periodEnd ? fromStripeTs(periodEnd) : null
  const interval = getIntervalFromSub(subscription)
  const isCanceling = isSubscriptionCanceling(subscription)
  const customerId = getStripeCustomerId(subscription.customer)
  const subscriptionUserId = typeof subscription.metadata?.userId === 'string' ? subscription.metadata.userId : null
  const userId = await resolveAppUserIdForSubscription({ customerId, subscriptionUserId })
  const deferPeriodEnd = sourceEvent === 'customer.subscription.updated'
    && shouldDeferPeriodEndToInvoicePaid(subscription.status, isCanceling)

  const grantsAccess = subscriptionHasProAccess(subscription.status)

  const outcome = await applySubscriptionAccessFromStripe({
    subscriptionId: subscription.id,
    status: subscription.status,
    cancelAtPeriodEnd: isCanceling,
    currentPeriodEnd: deferPeriodEnd ? undefined : periodEndDate,
    subscriptionInterval: interval,
    userId,
    customerId,
    subscriptionStart: fromStripeTs(subscription.start_date),
  })

  const logContext = {
    subscriptionId: subscription.id,
    status: subscription.status,
    customerId,
    hasUserIdMetadata: Boolean(userId),
  }

  if (grantsAccess && (outcome === 'updated' || outcome === 'unchanged')) {
    const linkedUserIds = await getUserIdsByStripeSubscriptionId(subscription.id)
    if (linkedUserIds.length === 0) {
      throw new Error(
        `${sourceEvent} did not link subscription ${subscription.id} to any app user`,
      )
    }
  }

  if (outcome === 'updated') {
    log.info(
      sourceEvent,
      {
        ...logContext,
        interval: interval ?? 'unknown',
        currentPeriodEndsAt: periodEndDate?.toISOString() ?? 'unknown',
        accessEndsAt: isCanceling ? periodEndDate?.toISOString() ?? 'unknown' : null,
      },
      isCanceling ? 'subscription scheduled to cancel at period end' : 'subscription active after renewal or reactivation',
    )
    return
  }

  if (outcome === 'unchanged') {
    log.info(
      sourceEvent,
      logContext,
      grantsAccess
        ? 'subscription already matches Stripe — no database write needed'
        : 'subscription state unchanged',
    )
    return
  }

  if (outcome === 'cleared') {
    log.warn(
      sourceEvent,
      logContext,
      'abandoned subscription cleared locally so checkout can be retried',
    )
    return
  }

  log.warn(
    sourceEvent,
    {
      ...logContext,
      accessEndsAt: periodEndDate?.toISOString() ?? 'immediately',
    },
    'subscription retained locally without Pro access because Stripe status no longer grants entitlements',
  )
}
