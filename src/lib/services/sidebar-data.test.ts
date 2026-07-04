import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/sync/passive-billing-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/sync/passive-billing-sync')>()
  return {
    ...actual,
    maybeReconcileBillingStateForUser: vi.fn(),
    maybeReconcileOrphanSubscriptionForUser: vi.fn(),
  }
})

import {
  maybeReconcileBillingStateForUser,
  maybeReconcileOrphanSubscriptionForUser,
} from '@/lib/billing/sync/passive-billing-sync'
import {
  resolveLayoutBillingSidebarOptions,
  loadAppSidebarData,
  SIDEBAR_DEFAULT_OPTIONS,
} from '@/lib/services/sidebar-data'

const mockMaybeReconcileBilling = vi.mocked(maybeReconcileBillingStateForUser)
const mockMaybeReconcileOrphan = vi.mocked(maybeReconcileOrphanSubscriptionForUser)

vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  resolveProAccessForBillingContext: vi.fn(),
}))

vi.mock('@/lib/db/sidebar', () => ({
  fetchSidebarData: vi.fn((user: unknown) => ({
    collections: [],
    itemTypes: [],
    user,
  })),
}))

import { resolveProAccessForBillingContext } from '@/lib/billing/access/pro-access-resolution'
import { fetchSidebarData } from '@/lib/db/sidebar'

const mockResolveProAccess = vi.mocked(resolveProAccessForBillingContext)
const mockFetchSidebarData = vi.mocked(fetchSidebarData)

describe('resolveLayoutBillingSidebarOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns default options when userId is missing', () => {
    expect(resolveLayoutBillingSidebarOptions(undefined)).toBe(SIDEBAR_DEFAULT_OPTIONS)
    expect(mockMaybeReconcileBilling).not.toHaveBeenCalled()
  })

  it('always returns default options immediately (billing sync deferred to background)', () => {
    mockMaybeReconcileBilling.mockResolvedValue({ status: 'updated' })
    mockMaybeReconcileOrphan.mockResolvedValue(false)

    // Function returns immediately with default options; sync happens in background
    expect(resolveLayoutBillingSidebarOptions('user-1')).toBe(SIDEBAR_DEFAULT_OPTIONS)
  })

  it('defers billing sync to background when reconcile would mutate state', () => {
    mockMaybeReconcileBilling.mockResolvedValue(null)
    mockMaybeReconcileOrphan.mockResolvedValue(true)

    // Function returns immediately with default options; sync queued in background
    expect(resolveLayoutBillingSidebarOptions('user-1')).toBe(SIDEBAR_DEFAULT_OPTIONS)
  })

  it('handles errors in background billing sync gracefully', () => {
    mockMaybeReconcileBilling.mockRejectedValue(new Error('Stripe API unavailable'))

    // Function still returns default options even if sync would fail
    expect(resolveLayoutBillingSidebarOptions('user-1')).toBe(SIDEBAR_DEFAULT_OPTIONS)
  })
})

describe('loadAppSidebarData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMaybeReconcileBilling.mockResolvedValue(null)
    mockMaybeReconcileOrphan.mockResolvedValue(false)
    mockResolveProAccess.mockResolvedValue(true)
  })

  it('returns degraded sidebar when billing bootstrap throws', async () => {
    mockMaybeReconcileBilling.mockRejectedValue(new Error('DB unavailable'))

    const result = await loadAppSidebarData({
      user: { id: 'user-1', name: 'Ada', email: 'ada@example.com', image: null, isPro: true },
    })

    expect(mockFetchSidebarData).toHaveBeenCalledWith({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      image: null,
      isPro: true,
    })
    expect(result.user?.isPro).toBe(true)
    expect(result.collections).toEqual([])
  })
})
