import { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/infra/prisma'
import { createLogger } from '@/lib/infra/logger'
import type { SubscriptionInterval } from '@/generated/prisma'

const log = createLogger('db-stripe')

export async function getUserIdByStripeCustomerId(stripeCustomerId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { stripeCustomerId },
    select: { id: true },
  })
  return user?.id ?? null
}

export async function touchUserLastStripeSyncAt(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastStripeSyncAt: new Date() },
  })
}

export interface UserStripeInfo {
  email: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  isPro: boolean
  subscriptionStart: Date | null
  currentPeriodEnd: Date | null
  subscriptionInterval: SubscriptionInterval | null
  cancelAtPeriodEnd: boolean
  lastStripeSyncAt: Date | null
  proExpiredAt: Date | null
}

export async function getUserStripeInfo(userId: string): Promise<UserStripeInfo | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      isPro: true,
      subscriptionStart: true,
      currentPeriodEnd: true,
      subscriptionInterval: true,
      cancelAtPeriodEnd: true,
      lastStripeSyncAt: true,
      proExpiredAt: true,
    },
  })
}

export async function getUserIdsByStripeSubscriptionId(stripeSubscriptionId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { stripeSubscriptionId },
    select: { id: true },
  })
  return users.map((user) => user.id)
}

export async function clearStripeCustomerByCustomerId(stripeCustomerId: string) {
  const users = await prisma.user.findMany({
    where: { stripeCustomerId },
    select: { id: true },
  })
  if (users.length === 0) return { count: 0, userIds: [] as string[] }

  const result = await prisma.user.updateMany({
    where: { stripeCustomerId },
    data: {
      isPro: false,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      subscriptionInterval: null,
      cancelAtPeriodEnd: false,
      lastStripeSyncAt: new Date(),
    },
  })
  const userIds = users.map((user) => user.id)
  log.info('stripe_customer_cleared', { stripeCustomerId, count: result.count }, 'Cleared Stripe customer link from local users')
  return { count: result.count, userIds }
}

interface UpdateUserStripeSubscriptionParams {
  stripeCustomerId: string
  stripeSubscriptionId: string
  isPro: boolean
  subscriptionStart?: Date
  currentPeriodEnd?: Date | null
  lastStripeSyncAt?: Date
  subscriptionInterval?: SubscriptionInterval
  cancelAtPeriodEnd?: boolean
}

async function clearConflictingStripeSubscriptionLink(
  stripeSubscriptionId: string,
  targetUserId: string,
): Promise<string[]> {
  const owner = await prisma.user.findUnique({
    where: { stripeSubscriptionId },
    select: { id: true },
  })
  if (!owner || owner.id === targetUserId) return []

  log.warn('Clearing stale stripeSubscriptionId from another user before reassignment', {
    stripeSubscriptionId,
    previousUserId: owner.id,
    targetUserId,
  })
  const result = await clearStripeSubscriptionBySubId(stripeSubscriptionId)
  return result.userIds
}

async function clearConflictingStripeCustomerLink(
  stripeCustomerId: string,
  targetUserId: string,
): Promise<string[]> {
  const owner = await prisma.user.findUnique({
    where: { stripeCustomerId },
    select: { id: true },
  })
  if (!owner || owner.id === targetUserId) return []

  log.warn('Clearing stale stripeCustomerId from another user before reassignment', {
    stripeCustomerId,
    previousUserId: owner.id,
    targetUserId,
  })
  await prisma.user.update({
    where: { id: owner.id },
    data: {
      isPro: false,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      subscriptionInterval: null,
      cancelAtPeriodEnd: false,
      lastStripeSyncAt: new Date(),
    },
  })
  return [owner.id]
}

export async function updateUserStripeSubscription(userId: string, params: UpdateUserStripeSubscriptionParams) {
  const {
    stripeCustomerId,
    stripeSubscriptionId,
    isPro,
    subscriptionStart,
    currentPeriodEnd,
    lastStripeSyncAt,
    subscriptionInterval,
    cancelAtPeriodEnd,
  } = params

  const conflictClearedUserIds = [
    ...(await clearConflictingStripeSubscriptionLink(stripeSubscriptionId, userId)),
    ...(await clearConflictingStripeCustomerLink(stripeCustomerId, userId)),
  ]

  try {
    const result = await prisma.user.update({
      where: { id: userId },
      data: {
        isPro,
        stripeCustomerId,
        stripeSubscriptionId,
        cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
        ...(isPro ? { proExpiredAt: null } : {}),
        ...(subscriptionStart && { subscriptionStart }),
        ...(currentPeriodEnd !== undefined && { currentPeriodEnd }),
        ...(lastStripeSyncAt && { lastStripeSyncAt }),
        ...(subscriptionInterval && { subscriptionInterval }),
      },
    })
    log.info('subscription_state_updated', { userId, isPro, stripeSubscriptionId, subscriptionInterval }, 'Updated user Stripe subscription link')
    return { result, userIds: [...new Set([userId, ...conflictClearedUserIds])] }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target ?? 'unknown')
      log.error('Unique constraint prevented Stripe subscription link — manual reconciliation required', {
        userId,
        stripeCustomerId,
        stripeSubscriptionId,
        constraint: target,
      })
    }
    throw error
  }
}

interface UpdateSubscriptionStateData {
  isPro?: boolean
  cancelAtPeriodEnd?: boolean
  subscriptionInterval?: SubscriptionInterval
  currentPeriodEnd?: Date | null
  lastStripeSyncAt?: Date
}

export async function updateSubscriptionState(
  stripeSubscriptionId: string,
  data: UpdateSubscriptionStateData,
) {
  const userIds = await getUserIdsByStripeSubscriptionId(stripeSubscriptionId)
  const result = await prisma.user.updateMany({
    where: { stripeSubscriptionId },
    data,
  })
  return { count: result.count, userIds }
}

export async function clearStripeSubscriptionBySubId(stripeSubscriptionId: string, proExpiredAt?: Date) {
  const userIds = await getUserIdsByStripeSubscriptionId(stripeSubscriptionId)
  const result = await prisma.user.updateMany({
    where: { stripeSubscriptionId },
    data: {
      isPro: false,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      lastStripeSyncAt: new Date(),
      subscriptionInterval: null,
      cancelAtPeriodEnd: false,
      // subscriptionStart kept as a historical record of when they first went Pro
      ...(proExpiredAt && { proExpiredAt }),
    },
  })
  log.info('subscription_link_cleared', { stripeSubscriptionId, proExpiredAt }, 'Cleared local Stripe subscription link')
  return { count: result.count, userIds }
}
