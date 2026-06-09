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
  SIDEBAR_FRESH_OPTIONS,
} from '@/lib/app/sidebar-data'

const mockMaybeReconcileBilling = vi.mocked(maybeReconcileBillingStateForUser)
const mockMaybeReconcileOrphan = vi.mocked(maybeReconcileOrphanSubscriptionForUser)

vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  resolveProAccessForBillingContext: vi.fn(),
}))

vi.mock('@/lib/db/sidebar', () => ({
  fetchSidebarData: vi.fn(async (user) => ({
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

  it('returns default options when userId is missing', async () => {
    expect(await resolveLayoutBillingSidebarOptions(undefined)).toBe(SIDEBAR_DEFAULT_OPTIONS)
    expect(mockMaybeReconcileBilling).not.toHaveBeenCalled()
  })

  it('returns fresh options when passive sync mutates local state', async () => {
    mockMaybeReconcileBilling.mockResolvedValue({ status: 'updated' })
    mockMaybeReconcileOrphan.mockResolvedValue(false)

    expect(await resolveLayoutBillingSidebarOptions('user-1')).toBe(SIDEBAR_FRESH_OPTIONS)
  })

  it('returns fresh options when orphan reconcile links a subscription', async () => {
    mockMaybeReconcileBilling.mockResolvedValue(null)
    mockMaybeReconcileOrphan.mockResolvedValue(true)

    expect(await resolveLayoutBillingSidebarOptions('user-1')).toBe(SIDEBAR_FRESH_OPTIONS)
  })

  it('returns default options when neither reconcile path mutates state', async () => {
    mockMaybeReconcileBilling.mockResolvedValue({ status: 'unchanged' })
    mockMaybeReconcileOrphan.mockResolvedValue(false)

    expect(await resolveLayoutBillingSidebarOptions('user-1')).toBe(SIDEBAR_DEFAULT_OPTIONS)
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
