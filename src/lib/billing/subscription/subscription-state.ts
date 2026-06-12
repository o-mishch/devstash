import 'server-only'

/**
 * Canonical Stripe subscription write path — DB mutations only.
 * Webhooks, passive sync, checkout finalization, and account lifecycle should import from here.
 */
import {
  clearStripeCustomerByCustomerId as clearStripeCustomerByCustomerIdInDb,
  clearStripeSubscriptionBySubId as clearStripeSubscriptionBySubIdInDb,
  getUserIdByStripeCustomerId,
  touchUserLastStripeSyncAt as touchUserLastStripeSyncAtInDb,
  updateSubscriptionState as updateSubscriptionStateInDb,
  updateUserStripeSubscription as updateUserStripeSubscriptionInDb,
} from '@/lib/db/stripe'
import { getUserById } from '@/lib/db/users'
import { retrieveStripeCustomer } from '@/lib/billing/stripe-api'
import { createLogger } from '@/lib/infra/logger'

type ClearStripeCustomerResult = Awaited<ReturnType<typeof clearStripeCustomerByCustomerIdInDb>>
type UpdateUserStripeSubscriptionParams = Parameters<typeof updateUserStripeSubscriptionInDb>[1]
type UpdateSubscriptionStateData = Parameters<typeof updateSubscriptionStateInDb>[1]

const resolveLog = createLogger('stripe-subscription-resolve')

export async function clearStripeCustomerByCustomerId(
  stripeCustomerId: string,
): Promise<ClearStripeCustomerResult> {
  return clearStripeCustomerByCustomerIdInDb(stripeCustomerId)
}

export async function updateUserStripeSubscription(
  userId: string,
  params: UpdateUserStripeSubscriptionParams,
) {
  const result = await updateUserStripeSubscriptionInDb(userId, params)
  return result.result
}

export async function updateSubscriptionState(
  stripeSubscriptionId: string,
  data: UpdateSubscriptionStateData,
) {
  const result = await updateSubscriptionStateInDb(stripeSubscriptionId, data)
  return { count: result.count }
}

export async function clearStripeSubscriptionBySubId(
  stripeSubscriptionId: string,
  proExpiredAt?: Date,
) {
  const result = await clearStripeSubscriptionBySubIdInDb(stripeSubscriptionId, proExpiredAt)
  return { count: result.count }
}

/** Throttle-only timestamp — does not affect Pro access. */
export async function touchUserLastStripeSyncAt(userId: string): Promise<void> {
  await touchUserLastStripeSyncAtInDb(userId)
}

export interface ResolveAppUserIdInput {
  customerId: string | null
  subscriptionUserId?: string | null
}

/**
 * Resolves the DevStash user ID for a Stripe subscription.
 * Order: subscription metadata → local DB by customer ID → Stripe customer metadata.
 */
export async function resolveAppUserIdForSubscription(
  input: ResolveAppUserIdInput,
): Promise<string | null> {
  const fromSubscription = input.subscriptionUserId?.trim()
  if (fromSubscription) {
    if (input.customerId) {
      const fromDb = await getUserIdByStripeCustomerId(input.customerId)
      if (fromDb && fromDb !== fromSubscription) {
        resolveLog.warn('Subscription metadata userId mismatches local customer link — using DB user', {
          customerId: input.customerId,
          metadataUserId: fromSubscription,
          dbUserId: fromDb,
        })
        return fromDb
      }
      if (fromDb) return fromSubscription
    }
    const metadataUser = await getUserById(fromSubscription)
    if (!metadataUser) {
      resolveLog.warn('Subscription metadata userId does not match a local user', {
        customerId: input.customerId,
        metadataUserId: fromSubscription,
      })
      return null
    }
    return fromSubscription
  }

  if (!input.customerId) return null

  const fromDb = await getUserIdByStripeCustomerId(input.customerId)
  if (fromDb) return fromDb

  const customer = await retrieveStripeCustomer(input.customerId)
  if (!customer) return null

  const fromCustomerMeta = customer.metadata?.userId
  if (typeof fromCustomerMeta === 'string' && fromCustomerMeta.trim()) {
    const metaUser = await getUserById(fromCustomerMeta.trim())
    if (!metaUser) {
      resolveLog.warn('Stripe customer metadata userId does not match a local user', {
        customerId: input.customerId,
        metadataUserId: fromCustomerMeta,
      })
      return null
    }
    return fromCustomerMeta.trim()
  }

  return null
}
