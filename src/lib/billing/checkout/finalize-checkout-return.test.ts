import { describe, it, expect, vi, beforeEach } from 'vitest'
import { finalizeCheckoutReturn } from '@/lib/billing/checkout/finalize-checkout-return'
import { finalizeCheckoutSessionForUser } from '@/lib/billing/checkout/stripe-checkout'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/billing/checkout/stripe-checkout', () => ({
  finalizeCheckoutSessionForUser: vi.fn(),
}))

vi.mock('@/lib/billing/sync/passive-billing-sync', () => ({
  syncSubscriptionStateForUser: vi.fn(),
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import { syncSubscriptionStateForUser } from '@/lib/billing/sync/passive-billing-sync'

const mockSyncSubscriptionStateForUser = syncSubscriptionStateForUser as ReturnType<typeof vi.fn>

describe('finalizeCheckoutReturn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no checkout params are present', async () => {
    const result = await finalizeCheckoutReturn({ userId: 'user-1' })

    expect(result).toBeNull()
  })

  it('returns success when checkout grants Pro access', async () => {
    vi.mocked(finalizeCheckoutSessionForUser).mockResolvedValue({ status: 'ok', grantsAccess: true })

    const result = await finalizeCheckoutReturn({
      userId: 'user-1',
      checkoutSuccess: true,
      sessionId: 'cs_test_123',
    })

    expect(finalizeCheckoutSessionForUser).toHaveBeenCalledWith('user-1', 'cs_test_123')
    expect(result).toEqual({ type: 'success' })
  })

  it('returns syncing when checkout persists but Pro is not granted yet', async () => {
    vi.mocked(finalizeCheckoutSessionForUser).mockResolvedValue({ status: 'ok', grantsAccess: false })

    const result = await finalizeCheckoutReturn({
      userId: 'user-1',
      checkoutSuccess: true,
      sessionId: 'cs_test_123',
    })

    expect(result).toEqual({ type: 'syncing' })
  })

  it('returns forbidden info when session belongs to another user', async () => {
    vi.mocked(finalizeCheckoutSessionForUser).mockResolvedValue({ status: 'forbidden' })

    const result = await finalizeCheckoutReturn({
      userId: 'user-1',
      checkoutSuccess: true,
      sessionId: 'cs_test_123',
    })

    expect(result).toEqual({
      type: 'info',
      messageKey: 'session_owner_mismatch',
    })
  })

  it('returns invalid session info when checkout session is malformed', async () => {
    vi.mocked(finalizeCheckoutSessionForUser).mockResolvedValue({ status: 'invalid_session' })

    const result = await finalizeCheckoutReturn({
      userId: 'user-1',
      checkoutSuccess: true,
      sessionId: 'cs_test_123',
    })

    expect(result).toEqual({
      type: 'info',
      messageKey: 'invalid_session',
    })
  })

  it('returns success when sync updates subscription without a session id', async () => {
    mockSyncSubscriptionStateForUser.mockResolvedValue({ status: 'updated' })

    const result = await finalizeCheckoutReturn({
      userId: 'user-1',
      checkoutSuccess: true,
    })

    expect(mockSyncSubscriptionStateForUser).toHaveBeenCalledWith('user-1', { attemptOrphanReconcile: true })
    expect(result).toEqual({ type: 'success' })
  })

  it('returns syncing when sync is unchanged without a session id', async () => {
    mockSyncSubscriptionStateForUser.mockResolvedValue({ status: 'unchanged' })

    const result = await finalizeCheckoutReturn({
      userId: 'user-1',
      checkoutSuccess: true,
    })

    expect(result).toEqual({ type: 'syncing' })
  })

  it('returns info when sync finds no subscription without a session id', async () => {
    mockSyncSubscriptionStateForUser.mockResolvedValue({ status: 'no_subscription' })

    const result = await finalizeCheckoutReturn({
      userId: 'user-1',
      checkoutSuccess: true,
    })

    expect(result).toEqual({
      type: 'info',
      messageKey: 'no_subscription',
    })
  })

  it('returns info when sync revokes access without a session id', async () => {
    mockSyncSubscriptionStateForUser.mockResolvedValue({ status: 'revoked' })

    const result = await finalizeCheckoutReturn({
      userId: 'user-1',
      checkoutSuccess: true,
    })

    expect(result).toEqual({
      type: 'info',
      messageKey: 'activation_failed',
    })
  })

  it('returns success when session fetch is unavailable but sync succeeds', async () => {
    vi.mocked(finalizeCheckoutSessionForUser).mockResolvedValue({ status: 'unavailable' })
    mockSyncSubscriptionStateForUser.mockResolvedValue({ status: 'updated' })

    const result = await finalizeCheckoutReturn({
      userId: 'user-1',
      checkoutSuccess: true,
      sessionId: 'cs_test_123',
    })

    expect(mockSyncSubscriptionStateForUser).toHaveBeenCalledWith('user-1', { attemptOrphanReconcile: true })
    expect(result).toEqual({ type: 'success' })
  })
})
