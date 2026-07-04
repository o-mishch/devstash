import 'server-only'

import { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/infra/prisma'
import { logger } from '@/lib/infra/pino'
import type { SubscriptionInterval } from '@/generated/prisma'

const log = logger.child({ tag: 'db-stripe' })

interface ClearedStripeFieldsOptions {
  includeCustomerId?: boolean
  proExpiredAt?: Date
}

// Shared "reset Stripe subscription columns" payload used by every clear path, so a
// newly added Stripe column can't be reset in one path but forgotten in another.
// stripeSubscriptionStart is intentionally never cleared — it's kept as a historical
// record of when the user first went Pro.
function buildClearedStripeFields(options: ClearedStripeFieldsOptions = {}): Prisma.UserUpdateManyMutationInput {
  return {
    isPro: false,
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: null,
    stripeCurrentPeriodEnd: null,
    stripeSubscriptionInterval: null,
    stripeCancelAtPeriodEnd: false,
    stripeLastSyncAt: new Date(),
    ...(options.includeCustomerId ? { stripeCustomerId: null } : {}),
    ...(options.proExpiredAt ? { proExpiredAt: options.proExpiredAt } : {}),
  }
}

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
    data: buildClearedStripeFields({ includeCustomerId: true }),
  })
  const userIds = users.map((user) => user.id)
  log.info({ stripeCustomerId, count: result.count }, 'DB: stripe_customer_cleared — Cleared Stripe customer link from local users')
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

  log.warn({
    stripeSubscriptionId,
    previousUserId: owner.id,
    targetUserId,
  }, 'DB: Clearing stale stripeSubscriptionId from another user before reassignment')
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

  log.warn({
    stripeCustomerId,
    previousUserId: owner.id,
    targetUserId,
  }, 'DB: Clearing stale stripeCustomerId from another user before reassignment')
  await prisma.user.update({
    where: { id: owner.id },
    data: buildClearedStripeFields({ includeCustomerId: true }),
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
    log.info({ userId, isPro, stripeSubscriptionId, stripeSubscriptionInterval }, 'DB: subscription_state_updated — Updated user Stripe subscription link')
    return { result, userIds: [...new Set([userId, ...conflictClearedUserIds])] }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const rawTarget = error.meta?.target
      let target = 'unknown'
      if (Array.isArray(rawTarget)) target = rawTarget.join(',')
      else if (typeof rawTarget === 'string') target = rawTarget
      log.error({
        userId,
        stripeCustomerId,
        stripeSubscriptionId,
        constraint: target,
      }, 'DB: Unique constraint prevented Stripe subscription link — manual reconciliation required')
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
    data: buildClearedStripeFields({ proExpiredAt }),
  })
  log.info({ stripeSubscriptionId, proExpiredAt }, 'DB: subscription_link_cleared — Cleared local Stripe subscription link')
  return { count: result.count, userIds }
}
