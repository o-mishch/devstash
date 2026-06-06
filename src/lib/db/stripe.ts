import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { fetchLiveSubscriptionState } from '@/lib/stripe'
import type { SubscriptionInterval } from '@/generated/prisma'

const log = createLogger('stripe-db')

export async function getUserStripeInfo(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionStart: true,
      currentPeriodEnd: true,
      subscriptionInterval: true,
      cancelAtPeriodEnd: true,
    },
  })
}

export async function getSubscriptionForDisplay(userId: string) {
  const stripeInfo = await getUserStripeInfo(userId)
  if (!stripeInfo) return null

  let { currentPeriodEnd, cancelAtPeriodEnd, subscriptionInterval: interval } = stripeInfo
  let isStale = false

  // DB may be stale (missed webhooks). Fetch live state from Stripe for display only.
  // Triggers whenever any key field is missing (currentPeriodEnd or interval).
  // It does not catch a missed cancel/reactivation webhook if these fields are present.
  if (stripeInfo.stripeSubscriptionId && (!currentPeriodEnd || !interval)) {
    const live = await fetchLiveSubscriptionState(stripeInfo.stripeSubscriptionId)
    if (live) {
      currentPeriodEnd = live.currentPeriodEnd
      cancelAtPeriodEnd = live.cancelAtPeriodEnd
      if (live.interval) interval = live.interval
      isStale = true
      log.warn('Subscription state stale in DB — showing live Stripe data, sync queued', { subscriptionId: stripeInfo.stripeSubscriptionId })
    }
  }

  return {
    ...stripeInfo,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    subscriptionInterval: interval,
    isStale,
  }
}

interface UpdateUserStripeSubscriptionParams {
  stripeCustomerId: string
  stripeSubscriptionId: string
  isPro: boolean
  subscriptionStart?: Date
  currentPeriodEnd?: Date
  subscriptionInterval?: SubscriptionInterval
}

export async function updateUserStripeSubscription(userId: string, params: UpdateUserStripeSubscriptionParams) {
  const { stripeCustomerId, stripeSubscriptionId, isPro, subscriptionStart, currentPeriodEnd, subscriptionInterval } = params
  const result = await prisma.user.update({
    where: { id: userId },
    data: {
      isPro,
      stripeCustomerId,
      stripeSubscriptionId,
      cancelAtPeriodEnd: false,
      ...(subscriptionStart && { subscriptionStart }),
      ...(currentPeriodEnd && { currentPeriodEnd }),
      ...(subscriptionInterval && { subscriptionInterval }),
    },
  })
  log.info(`updateUserStripeSubscription → user:${userId} isPro=${isPro}`, { stripeSubscriptionId, subscriptionInterval })
  return result
}

export async function updateSubscriptionState(
  stripeSubscriptionId: string,
  data: {
    cancelAtPeriodEnd?: boolean
    subscriptionInterval?: SubscriptionInterval
    currentPeriodEnd?: Date
  },
) {
  const result = await prisma.user.updateMany({
    where: { stripeSubscriptionId },
    data,
  })
  return result
}

export async function clearStripeSubscriptionBySubId(stripeSubscriptionId: string, proExpiredAt?: Date) {
  const result = await prisma.user.updateMany({
    where: { stripeSubscriptionId },
    data: {
      isPro: false,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      subscriptionInterval: null,
      cancelAtPeriodEnd: false,
      // subscriptionStart kept as a historical record of when they first went Pro
      ...(proExpiredAt && { proExpiredAt }),
    },
  })
  log.info(`clearStripeSubscriptionBySubId → subscription:${stripeSubscriptionId} cleared, isPro=false`, { proExpiredAt })
  return result
}
