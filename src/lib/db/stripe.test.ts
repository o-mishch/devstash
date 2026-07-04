import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockReset } from 'vitest-mock-extended'
import { objectContaining } from '@/test/matchers'

vi.mock('@/lib/infra/prisma', async () => (await import('@/test/prisma-mock')).createPrismaMockModule())

import { prisma } from '@/lib/infra/prisma'
import { asPrismaMock } from '@/test/prisma-mock'
import { updateUserStripeSubscription } from './stripe'

const prismaMock = asPrismaMock(prisma)

const mockUpdate = prismaMock.user.update
const mockFindUnique = prismaMock.user.findUnique

// The full Prisma User row; lets partial test fixtures satisfy mockResolvedValue's typing
// without pulling in the model type or falling back to `as unknown as never`.
type PrismaUser = NonNullable<Awaited<ReturnType<typeof prismaMock.user.findUnique>>>

describe('updateUserStripeSubscription', () => {
  beforeEach(() => {
    mockReset(prismaMock)
    prismaMock.user.findUnique.mockResolvedValue(null)
    prismaMock.user.update.mockResolvedValue({ id: 'user-target' } as PrismaUser)
  })

  it('clears full billing state from the previous customer owner before reassignment', async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'user-previous' } as PrismaUser)

    await updateUserStripeSubscription('user-target', {
      stripeCustomerId: 'cus_new',
      stripeSubscriptionId: 'sub_new',
      isPro: true,
    })

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'user-previous' },
      data: objectContaining({
        isPro: false,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripeSubscriptionInterval: null,
        stripeCancelAtPeriodEnd: false,
      }),
    })
  })

  it('clears proExpiredAt when granting Pro access', async () => {
    await updateUserStripeSubscription('user-target', {
      stripeCustomerId: 'cus_new',
      stripeSubscriptionId: 'sub_new',
      isPro: true,
    })

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'user-target' },
      data: objectContaining({
        isPro: true,
        proExpiredAt: null,
      }),
    })
  })
})
