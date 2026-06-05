import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('stripe-db')

export async function getUserStripeCustomerId(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  })
}

export async function getUserSubscriptionDates(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionStart: true,
      currentPeriodEnd: true,
    },
  })
}

export async function updateUserStripeSubscription(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  isPro: boolean,
  subscriptionStart?: Date,
  currentPeriodEnd?: Date
) {
  const result = await prisma.user.update({
    where: { id: userId },
    data: {
      isPro,
      stripeCustomerId,
      stripeSubscriptionId,
      ...(subscriptionStart && { subscriptionStart }),
      ...(currentPeriodEnd && { currentPeriodEnd }),
    },
  })
  log.info(`Updated subscription for user:${userId} isPro=${isPro}`)
  return result
}

export async function updateSubscriptionPeriodEnd(
  stripeSubscriptionId: string,
  currentPeriodEnd: Date
) {
  const result = await prisma.user.updateMany({
    where: { stripeSubscriptionId },
    data: { currentPeriodEnd },
  })
  log.info(`Updated period end for subscription:${stripeSubscriptionId}`)
  return result
}

export async function clearStripeSubscriptionBySubId(stripeSubscriptionId: string, proExpiredAt?: Date) {
  const result = await prisma.user.updateMany({
    where: { stripeSubscriptionId },
    data: {
      isPro: false,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      // subscriptionStart kept as a historical record of when they first went Pro
      ...(proExpiredAt && { proExpiredAt }),
    },
  })
  log.info(`Cleared subscription:${stripeSubscriptionId}`)
  return result
}
