import 'server-only'

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
    data: { stripeLastSyncAt: new Date() },
  })
}

export interface UserStripeInfo {
  email: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripeSubscriptionStatus: string | null
  isPro: boolean
  stripeSubscriptionStart: Date | null
  stripeCurrentPeriodEnd: Date | null
  stripeSubscriptionInterval: SubscriptionInterval | null
  stripeCancelAtPeriodEnd: boolean
  stripeLastSyncAt: Date | null
  proExpiredAt: Date | null
}

export async function getUserStripeInfo(userId: string): Promise<UserStripeInfo | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripeSubscriptionStatus: true,
      isPro: true,
      stripeSubscriptionStart: true,
      stripeCurrentPeriodEnd: true,
      stripeSubscriptionInterval: true,
      stripeCancelAtPeriodEnd: true,
      stripeLastSyncAt: true,
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
      stripeSubscriptionStatus: null,
      stripeCurrentPeriodEnd: null,
      stripeSubscriptionInterval: null,
      stripeCancelAtPeriodEnd: false,
      stripeLastSyncAt: new Date(),
    },
  })
  const userIds = users.map((user) => user.id)
  log.info('DB: stripe_customer_cleared', { stripeCustomerId, count: result.count }, 'Cleared Stripe customer link from local users')
  return { count: result.count, userIds }
}

interface UpdateUserStripeSubscriptionParams {
  stripeCustomerId: string
  stripeSubscriptionId: string
  isPro: boolean
  stripeSubscriptionStatus?: string | null
  stripeSubscriptionStart?: Date
  stripeCurrentPeriodEnd?: Date | null
  stripeLastSyncAt?: Date
  stripeSubscriptionInterval?: SubscriptionInterval
  stripeCancelAtPeriodEnd?: boolean
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

  log.warn('DB: Clearing stale stripeSubscriptionId from another user before reassignment', {
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

  log.warn('DB: Clearing stale stripeCustomerId from another user before reassignment', {
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
      stripeSubscriptionStatus: null,
      stripeCurrentPeriodEnd: null,
      stripeSubscriptionInterval: null,
      stripeCancelAtPeriodEnd: false,
      stripeLastSyncAt: new Date(),
    },
  })
  return [owner.id]
}

export async function updateUserStripeSubscription(userId: string, params: UpdateUserStripeSubscriptionParams) {
  const {
    stripeCustomerId,
    stripeSubscriptionId,
    isPro,
    stripeSubscriptionStatus,
    stripeSubscriptionStart,
    stripeCurrentPeriodEnd,
    stripeLastSyncAt,
    stripeSubscriptionInterval,
    stripeCancelAtPeriodEnd,
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
        stripeCancelAtPeriodEnd: stripeCancelAtPeriodEnd ?? false,
        ...(stripeSubscriptionStatus !== undefined && { stripeSubscriptionStatus }),
        ...(isPro ? { proExpiredAt: null } : {}),
        ...(stripeSubscriptionStart && { stripeSubscriptionStart }),
        ...(stripeCurrentPeriodEnd !== undefined && { stripeCurrentPeriodEnd }),
        ...(stripeLastSyncAt && { stripeLastSyncAt }),
        ...(stripeSubscriptionInterval && { stripeSubscriptionInterval }),
      },
    })
    log.info('DB: subscription_state_updated', { userId, isPro, stripeSubscriptionId, stripeSubscriptionInterval }, 'Updated user Stripe subscription link')
    return { result, userIds: [...new Set([userId, ...conflictClearedUserIds])] }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target ?? 'unknown')
      log.error('DB: Unique constraint prevented Stripe subscription link — manual reconciliation required', {
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
  stripeSubscriptionStatus?: string | null
  stripeCancelAtPeriodEnd?: boolean
  stripeSubscriptionInterval?: SubscriptionInterval
  stripeCurrentPeriodEnd?: Date | null
  stripeLastSyncAt?: Date
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
      stripeSubscriptionStatus: null,
      stripeCurrentPeriodEnd: null,
      stripeLastSyncAt: new Date(),
      stripeSubscriptionInterval: null,
      stripeCancelAtPeriodEnd: false,
      // stripeSubscriptionStart kept as a historical record of when they first went Pro
      ...(proExpiredAt && { proExpiredAt }),
    },
  })
  log.info('DB: subscription_link_cleared', { stripeSubscriptionId, proExpiredAt }, 'Cleared local Stripe subscription link')
  return { count: result.count, userIds }
}
