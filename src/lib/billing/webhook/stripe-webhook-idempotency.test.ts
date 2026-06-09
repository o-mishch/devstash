import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetRedis,
  mockSet,
  mockGet,
  mockDel,
  mockClaimStripeWebhookEventInDb,
  mockMarkStripeWebhookEventProcessedInDb,
  mockReleaseStripeWebhookEventInDb,
  mockPruneOldStripeWebhookEvents,
  mockReleaseStaleStripeWebhookEvents,
} = vi.hoisted(() => ({
  mockGetRedis: vi.fn(),
  mockSet: vi.fn(),
  mockGet: vi.fn(),
  mockDel: vi.fn(),
  mockClaimStripeWebhookEventInDb: vi.fn(),
  mockMarkStripeWebhookEventProcessedInDb: vi.fn(),
  mockReleaseStripeWebhookEventInDb: vi.fn(),
  mockPruneOldStripeWebhookEvents: vi.fn(),
  mockReleaseStaleStripeWebhookEvents: vi.fn(),
}))

vi.mock('@/lib/infra/redis', () => ({
  getRedis: mockGetRedis,
}))

vi.mock('@/lib/db/stripe-webhook-events', () => ({
  STALE_WEBHOOK_PROCESSING_MS: 15 * 60 * 1000,
  claimStripeWebhookEventInDb: mockClaimStripeWebhookEventInDb,
  markStripeWebhookEventProcessedInDb: mockMarkStripeWebhookEventProcessedInDb,
  releaseStripeWebhookEventInDb: mockReleaseStripeWebhookEventInDb,
  pruneOldStripeWebhookEvents: mockPruneOldStripeWebhookEvents,
  releaseStaleStripeWebhookEvents: mockReleaseStaleStripeWebhookEvents,
}))

import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  releaseStripeWebhookEvent,
} from './stripe-webhook-idempotency'

beforeEach(() => {
  vi.clearAllMocks()
  mockSet.mockReset()
  mockGet.mockReset()
  mockDel.mockReset()
  mockSet.mockResolvedValue('OK')
  mockGet.mockResolvedValue(undefined)
  mockDel.mockResolvedValue(1)
  mockGetRedis.mockReturnValue({
    set: mockSet,
    get: mockGet,
    del: mockDel,
  })
  mockClaimStripeWebhookEventInDb.mockResolvedValue(true)
  mockMarkStripeWebhookEventProcessedInDb.mockResolvedValue(undefined)
  mockReleaseStripeWebhookEventInDb.mockResolvedValue(undefined)
  mockPruneOldStripeWebhookEvents.mockResolvedValue(undefined)
  mockReleaseStaleStripeWebhookEvents.mockResolvedValue(0)
})

describe('claimStripeWebhookEvent', () => {
  it('claims in the database first, then sets a Redis marker', async () => {
    await expect(claimStripeWebhookEvent('evt_123', 'invoice.paid')).resolves.toBe(true)

    expect(mockClaimStripeWebhookEventInDb).toHaveBeenCalledWith('evt_123', 'invoice.paid')
    expect(mockSet).toHaveBeenCalledWith(
      'stripe:webhook:event:evt_123',
      expect.objectContaining({
        type: 'invoice.paid',
        status: 'processing',
      }),
      expect.objectContaining({
        nx: true,
        ex: 60 * 60 * 24 * 30,
      }),
    )
  })

  it('returns false when the database claim fails without touching Redis', async () => {
    mockClaimStripeWebhookEventInDb.mockResolvedValue(false)

    await expect(claimStripeWebhookEvent('evt_123', 'invoice.paid')).resolves.toBe(false)

    expect(mockSet).not.toHaveBeenCalled()
  })

  it('throws when stale reclaim retries are exhausted', async () => {
    mockClaimStripeWebhookEventInDb.mockRejectedValue(
      new Error('Failed to claim webhook event evt_123 after stale reclaim retries'),
    )

    await expect(claimStripeWebhookEvent('evt_123', 'invoice.paid')).rejects.toThrow(/Failed to claim webhook event/)
  })

  it('still succeeds when Redis is unavailable but the database claim succeeds', async () => {
    mockGetRedis.mockReturnValue(null)

    await expect(claimStripeWebhookEvent('evt_123', 'invoice.paid')).resolves.toBe(true)

    expect(mockClaimStripeWebhookEventInDb).toHaveBeenCalledWith('evt_123', 'invoice.paid')
  })

  it('prevents duplicate processing when the database claim fails on a second pod', async () => {
    mockClaimStripeWebhookEventInDb.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(claimStripeWebhookEvent('evt_123', 'invoice.paid')).resolves.toBe(true)
    await expect(claimStripeWebhookEvent('evt_123', 'invoice.paid')).resolves.toBe(false)
  })

  it('reclaims a stale Redis processing claim after a successful database claim', async () => {
    mockSet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('OK')
    mockGet.mockResolvedValue({
      type: 'invoice.paid',
      status: 'processing',
      claimedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    })

    await expect(claimStripeWebhookEvent('evt_123', 'invoice.paid')).resolves.toBe(true)

    expect(mockDel).toHaveBeenCalledWith('stripe:webhook:event:evt_123')
    expect(mockSet).toHaveBeenCalledTimes(2)
  })
})

describe('markStripeWebhookEventProcessed', () => {
  it('stores a processed marker in Redis and the database', async () => {
    await markStripeWebhookEventProcessed('evt_123', 'invoice.paid')

    expect(mockSet).toHaveBeenCalledWith(
      'stripe:webhook:event:evt_123',
      expect.objectContaining({
        type: 'invoice.paid',
        status: 'processed',
      }),
      expect.objectContaining({
        ex: 60 * 60 * 24 * 30,
      }),
    )
    expect(mockMarkStripeWebhookEventProcessedInDb).toHaveBeenCalledWith('evt_123')
  })

  it('still marks the database when Redis is unavailable', async () => {
    mockGetRedis.mockReturnValue(null)

    await markStripeWebhookEventProcessed('evt_123', 'invoice.paid')

    expect(mockMarkStripeWebhookEventProcessedInDb).toHaveBeenCalledWith('evt_123')
  })

  it('retries the database mark when the first attempt fails', async () => {
    mockMarkStripeWebhookEventProcessedInDb
      .mockRejectedValueOnce(new Error('db unavailable'))
      .mockResolvedValueOnce(undefined)

    await markStripeWebhookEventProcessed('evt_123', 'invoice.paid')

    expect(mockMarkStripeWebhookEventProcessedInDb).toHaveBeenCalledTimes(2)
  })

  it('throws when the database mark fails after retries', async () => {
    mockMarkStripeWebhookEventProcessedInDb.mockRejectedValue(new Error('db unavailable'))

    await expect(markStripeWebhookEventProcessed('evt_123', 'invoice.paid')).rejects.toThrow(
      'Failed to mark webhook event evt_123 as processed',
    )

    expect(mockMarkStripeWebhookEventProcessedInDb).toHaveBeenCalledTimes(3)
  })
})

describe('releaseStripeWebhookEvent', () => {
  it('deletes the Redis and database event locks', async () => {
    await releaseStripeWebhookEvent('evt_123')

    expect(mockDel).toHaveBeenCalledWith('stripe:webhook:event:evt_123')
    expect(mockReleaseStripeWebhookEventInDb).toHaveBeenCalledWith('evt_123')
  })
})
