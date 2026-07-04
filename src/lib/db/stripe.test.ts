import { beforeEach, describe, expect, it, vi } from 'vitest'
import { objectContaining } from '@/test/matchers'

const { mockUpdate, mockFindUnique, mockUpdateMany, mockFindMany } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockFindMany: vi.fn(),
}))

vi.mock('@/lib/infra/prisma', () => ({
  prisma: {
    user: {
      update: mockUpdate,
      findUnique: mockFindUnique,
      updateMany: mockUpdateMany,
      findMany: mockFindMany,
    },
  },
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import { updateUserStripeSubscription } from './stripe'

describe('updateUserStripeSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue(null)
    mockUpdate.mockResolvedValue({ id: 'user-target' })
  })

  it('clears full billing state from the previous customer owner before reassignment', async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'user-previous' })

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
