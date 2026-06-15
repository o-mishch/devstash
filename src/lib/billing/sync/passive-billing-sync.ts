import 'server-only'

import type Stripe from 'stripe'
import { cache } from 'react'
import { logger } from '@/lib/infra/pino'
import { shouldPassiveSyncBilling, shouldRunOrphanReconcile } from '@/lib/billing/config/billing-config'
import {
  getCachedLiveSubscriptionState,
  getCachedUserStripeInfo,
  getFreshUserStripeInfo,
} from '@/lib/billing/sync/user-billing-state'
import { applyLiveSubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { fetchSubscriptionDetails, mapSubscriptionToDetails } from '@/lib/billing/stripe-api'
import { resolveAppUserIdForSubscription } from '@/lib/billing/subscription/subscription-state'
import { resolveStripeCustomerForUser } from '@/lib/billing/checkout/stripe-checkout'
import { applySubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { touchUserLastStripeSyncAt } from '@/lib/billing/subscription/subscription-state'

const log = logger.child({ tag: 'passive-billing-sync' })
const logOrphan = logger.child({ tag: 'stripe-orphan-reconcile' })

export interface SubscriptionSyncResult {
  status: 'no_subscription' | 'unavailable' | 'revoked' | 'cleared' | 'updated' | 'unchanged'
  subscriptionId?: string
  stripeStatus?: Stripe.Subscription.Status | null
  exists?: boolean
}

export function subscriptionSyncMutatedLocalState(result: SubscriptionSyncResult | null): boolean {
  return result?.status === 'updated'
    || result?.status === 'revoked'
    || result?.status === 'cleared'
}

export interface SyncSubscriptionStateOptions {
  /** Run orphan Stripe lookup when the user has no local subscription ID. */
  attemptOrphanReconcile?: boolean
}

export interface OrphanReconcileHint {
  customerId: string
  blockingSubscription: Stripe.Subscription
}

async function subscriptionBelongsToUser(
  subscription: Stripe.Subscription,
  userId: string,
  customerId: string,
): Promise<boolean> {
  const subscriptionUserId = typeof subscription.metadata?.userId === 'string'
    ? subscription.metadata.userId
    : null
  if (subscriptionUserId === userId) return true
  const resolvedUserId = await resolveAppUserIdForSubscription({
    customerId,
    subscriptionUserId,
  })
  return resolvedUserId === userId
}

/**
 * Links a Stripe subscription to the local user when checkout/webhook sync was missed.
 * Returns true when a subscription was persisted to the database.
 */
export async function reconcileOrphanStripeSubscriptionForUser(
  userId: string,
  hint?: OrphanReconcileHint,
): Promise<boolean> {
  const user = await getCachedUserStripeInfo(userId)
  if (!user?.email || user.stripeSubscriptionId) return false

  let customerId = hint?.customerId ?? null
  let blockingSubscription = hint?.blockingSubscription ?? null
  const usedStripeLookup = !hint?.customerId || !hint?.blockingSubscription

  if (!customerId || !blockingSubscription) {
    const resolved = await resolveStripeCustomerForUser({
      userId,
      email: user.email,
      stripeCustomerId: user.stripeCustomerId,
    })
    customerId = resolved.customerId
    blockingSubscription = resolved.blockingSubscription
  }

  if (!customerId || !blockingSubscription) {
    if (usedStripeLookup) await touchUserLastStripeSyncAt(userId)
    return false
  }
  if (!await subscriptionBelongsToUser(blockingSubscription, userId, customerId)) {
    logOrphan.warn(
      {
        userId,
        subscriptionId: blockingSubscription.id,
        metadataUserId: blockingSubscription.metadata?.userId ?? null,
      },
      'Skipped orphan reconcile because subscription metadata points to another user',
    )
    if (usedStripeLookup) await touchUserLastStripeSyncAt(userId)
    return false
  }

  let details = mapSubscriptionToDetails(blockingSubscription)
  if (!details.interval) {
    const fetched = await fetchSubscriptionDetails(blockingSubscription.id)
    if (fetched) details = fetched
  }

  const outcome = await applySubscriptionAccessFromStripe({
    subscriptionId: blockingSubscription.id,
    status: details.status,
    currentPeriodEnd: details.currentPeriodEnd,
    subscriptionInterval: details.interval,
    userId,
    customerId,
    subscriptionStart: details.startDate,
    cancelAtPeriodEnd: details.cancelAtPeriodEnd,
  })

  if (outcome !== 'updated' && outcome !== 'unchanged') {
    logOrphan.warn(
      {
        userId,
        subscriptionId: blockingSubscription.id,
        outcome,
      },
      'Skipped orphan reconcile because subscription state could not be linked',
    )
    if (usedStripeLookup) await touchUserLastStripeSyncAt(userId)
    return false
  }

  logOrphan.info(
    {
      userId,
      subscriptionId: blockingSubscription.id,
      customerId,
      status: details.status,
      outcome,
    },
    'Orphan Stripe subscription linked to user after missed sync',
  )

  return true
}

export async function syncSubscriptionStateForUser(
  userId: string,
  options?: SyncSubscriptionStateOptions,
): Promise<SubscriptionSyncResult> {
  let user = await getCachedUserStripeInfo(userId)
  if (!user?.stripeSubscriptionId) {
    if (!options?.attemptOrphanReconcile) {
      return { status: 'no_subscription' }
    }
    const linked = await reconcileOrphanStripeSubscriptionForUser(userId)
    if (!linked) return { status: 'no_subscription' }
    user = await getFreshUserStripeInfo(userId)
    if (!user?.stripeSubscriptionId) return { status: 'no_subscription' }
  }

  const subscriptionId = user.stripeSubscriptionId
  const live = await getCachedLiveSubscriptionState(subscriptionId)
  if (!live) {
    return { status: 'unavailable', subscriptionId }
  }

  const outcome = await applyLiveSubscriptionAccessFromStripe(subscriptionId, live, {
    userId,
    customerId: user.stripeCustomerId,
  })

  if (outcome === 'revoked') {
    log.warn({
      subscriptionId,
      status: live.status,
      exists: live.exists,
    }, 'syncSubscriptionState → local Pro access revoked from live Stripe state')
    return {
      status: 'revoked',
      subscriptionId,
      stripeStatus: live.status,
      exists: live.exists,
    }
  }

  if (outcome === 'cleared') {
    log.warn({
      subscriptionId,
      status: live.status,
      exists: live.exists,
    }, 'syncSubscriptionState → local subscription link cleared from live Stripe state')
    return {
      status: 'cleared',
      subscriptionId,
      stripeStatus: live.status,
      exists: live.exists,
    }
  }

  if (outcome === 'unchanged') {
    log.info({ subscriptionId }, 'syncSubscriptionState → local state already matches Stripe')
    return {
      status: 'unchanged',
      subscriptionId,
      stripeStatus: live.status,
      exists: live.exists,
    }
  }

  log.info({ subscriptionId }, 'syncSubscriptionState → stale DB state synced from Stripe')
  return {
    status: 'updated',
    subscriptionId,
    stripeStatus: live.status,
    exists: live.exists,
  }
}

/** Passive safety-net sync for linked subscriptions — heals missed webhooks; request-scoped. */
export const maybeReconcileBillingStateForUser = cache(async (userId: string): Promise<SubscriptionSyncResult | null> => {
  const user = await getCachedUserStripeInfo(userId)
  if (!user || !shouldPassiveSyncBilling(user)) return null

  const result = await syncSubscriptionStateForUser(userId)
  if (result.status === 'no_subscription' || result.status === 'unavailable') {
    log.info({ userId, outcome: result.status }, 'Passive billing sync completed without state change')
  }
  return result
})

/** Throttled orphan lookup — runs from the app layout before sidebar data. */
export const maybeReconcileOrphanSubscriptionForUser = cache(async (userId: string): Promise<boolean> => {
  const user = await getCachedUserStripeInfo(userId)
  if (!user || !shouldRunOrphanReconcile(user)) return false
  return reconcileOrphanStripeSubscriptionForUser(userId)
})
