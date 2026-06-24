import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@/generated/prisma'

vi.mock('@/lib/auth/auth-service', () => ({
  verifyUserPasswordById: vi.fn(),
}))
vi.mock('@/lib/db/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/profile')>()
  return {
    getProfileData: vi.fn(),
    updateUserEmail: vi.fn(),
    buildOwnedEmails: actual.buildOwnedEmails,
    getProfileAccountSummary: actual.getProfileAccountSummary,
  }
})
const { mockOutboundEmailEnabled } = vi.hoisted(() => ({ mockOutboundEmailEnabled: vi.fn() }))
vi.mock('@/lib/utils/auth', () => ({ outboundEmailEnabled: mockOutboundEmailEnabled }))
vi.mock('@/lib/db/users', () => ({
  isEmailTakenByAnotherUser: vi.fn(),
}))
vi.mock('@/lib/billing/lifecycle/stripe-billing-lifecycle', () => ({
  syncStripeCustomerEmailForUserSafe: vi.fn(),
}))
vi.mock('@/lib/infra/cache', () => ({
  invalidateProfileCache: vi.fn(),
}))

import { getProfileData, updateUserEmail } from '@/lib/db/profile'
import { isEmailTakenByAnotherUser } from '@/lib/db/users'
import { syncStripeCustomerEmailForUserSafe } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { applyOwnedEmailChange, loadProfileContext } from '@/lib/services/profile-helpers'

const mockGetProfile = vi.mocked(getProfileData)
const mockIsEmailTaken = vi.mocked(isEmailTakenByAnotherUser)
const mockUpdateEmail = vi.mocked(updateUserEmail)
const mockSyncStripe = vi.mocked(syncStripeCustomerEmailForUserSafe)
const mockInvalidate = vi.mocked(invalidateProfileCache)

const OWNED_EMAIL = 'linked@google.com'

function profileRow(overrides?: { email?: string }): NonNullable<Awaited<ReturnType<typeof getProfileData>>> {
  return {
    user: {
      email: overrides?.email ?? 'me@example.com',
      credentialEmail: null,
      credentialEmailVerified: null,
      hasPassword: true,
      accounts: [{ id: 'acc-1', provider: 'google', email: OWNED_EMAIL }],
    },
  } as unknown as NonNullable<Awaited<ReturnType<typeof getProfileData>>>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProfile.mockResolvedValue(profileRow())
  mockIsEmailTaken.mockResolvedValue(false)
  mockUpdateEmail.mockResolvedValue(undefined)
})

describe('applyOwnedEmailChange', () => {
  it('returns 401 when the profile row is missing', async () => {
    mockGetProfile.mockResolvedValue(null)
    const result = await applyOwnedEmailChange({
      userId: 'user-1',
      newEmail: OWNED_EMAIL,
      notOwnedMessage: 'not owned',
    })
    expect(result).toEqual({ status: 401, message: 'Not authenticated.' })
  })

  it('returns 403 when the email is not owned', async () => {
    const result = await applyOwnedEmailChange({
      userId: 'user-1',
      newEmail: 'stranger@example.com',
      notOwnedMessage: 'not owned',
    })
    expect(result).toEqual({ status: 403, message: 'not owned' })
    expect(mockIsEmailTaken).not.toHaveBeenCalled()
  })

  it('returns 409 when another user holds the address on a linked account', async () => {
    mockIsEmailTaken.mockResolvedValue(true)
    const result = await applyOwnedEmailChange({
      userId: 'user-1',
      newEmail: OWNED_EMAIL,
      notOwnedMessage: 'not owned',
    })
    expect(result).toEqual({ status: 409, message: 'That email is already in use.' })
    expect(mockUpdateEmail).not.toHaveBeenCalled()
  })

  it('updates the primary email, syncs Stripe, and invalidates cache', async () => {
    const result = await applyOwnedEmailChange({
      userId: 'user-1',
      newEmail: OWNED_EMAIL,
      notOwnedMessage: 'not owned',
    })
    expect(result).toBeNull()
    expect(mockIsEmailTaken).toHaveBeenCalledWith('user-1', OWNED_EMAIL)
    expect(mockUpdateEmail).toHaveBeenCalledWith('user-1', OWNED_EMAIL)
    expect(mockSyncStripe).toHaveBeenCalledWith('user-1', OWNED_EMAIL)
    expect(mockInvalidate).toHaveBeenCalledWith('user-1')
  })

  it('no-ops when the new email is already current', async () => {
    mockGetProfile.mockResolvedValue(profileRow({ email: OWNED_EMAIL }))
    const result = await applyOwnedEmailChange({
      userId: 'user-1',
      newEmail: OWNED_EMAIL,
      notOwnedMessage: 'not owned',
    })
    expect(result).toBeNull()
    expect(mockIsEmailTaken).not.toHaveBeenCalled()
    expect(mockUpdateEmail).not.toHaveBeenCalled()
    expect(mockSyncStripe).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('returns 409 when a concurrent write hits the primary-email unique constraint', async () => {
    mockUpdateEmail.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )
    const result = await applyOwnedEmailChange({
      userId: 'user-1',
      newEmail: OWNED_EMAIL,
      notOwnedMessage: 'not owned',
    })
    expect(result).toEqual({ status: 409, message: 'That email is already in use.' })
    expect(mockSyncStripe).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('skips getProfileData when profile is passed', async () => {
    const row = profileRow()
    const result = await applyOwnedEmailChange({
      userId: 'user-1',
      newEmail: OWNED_EMAIL,
      notOwnedMessage: 'not owned',
      profile: row,
    })
    expect(result).toBeNull()
    expect(mockGetProfile).not.toHaveBeenCalled()
  })
})

const baseStats = { totalItems: 5, totalCollections: 2, itemTypeCounts: [] }

function profileContextRow(overrides?: {
  credentialEmailVerified?: Date | null
}): NonNullable<Awaited<ReturnType<typeof getProfileData>>> {
  return {
    user: {
      name: 'Ada',
      email: 'me@example.com',
      image: null,
      hasPassword: true,
      credentialEmail: 'me@example.com',
      credentialEmailVerified:
        overrides?.credentialEmailVerified === undefined
          ? new Date('2026-01-01T00:00:00.000Z')
          : overrides.credentialEmailVerified,
      isPro: true,
      createdAt: new Date('2025-12-25T10:30:00.000Z'),
      accounts: [{ id: 'acc-1', provider: 'google', email: OWNED_EMAIL }],
    },
    stats: baseStats,
  } as unknown as NonNullable<Awaited<ReturnType<typeof getProfileData>>>
}

describe('loadProfileContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProfile.mockResolvedValue(profileContextRow())
    mockOutboundEmailEnabled.mockReturnValue(true)
  })

  it('serializes createdAt to an ISO string (no Date drift between SSR seed and refetch)', async () => {
    const result = await loadProfileContext('user-1')
    expect(result?.createdAt).toBe('2025-12-25T10:30:00.000Z')
    expect(typeof result?.createdAt).toBe('string')
  })

  it('coerces a credentialEmailVerified date to true', async () => {
    expect((await loadProfileContext('user-1'))?.credentialEmailVerified).toBe(true)
  })

  it('coerces a null credentialEmailVerified to false', async () => {
    mockGetProfile.mockResolvedValue(profileContextRow({ credentialEmailVerified: null }))
    expect((await loadProfileContext('user-1'))?.credentialEmailVerified).toBe(false)
  })

  it('sets verificationDisabled to the negation of outboundEmailEnabled()', async () => {
    mockOutboundEmailEnabled.mockReturnValue(false)
    expect((await loadProfileContext('user-1'))?.verificationDisabled).toBe(true)

    mockOutboundEmailEnabled.mockReturnValue(true)
    expect((await loadProfileContext('user-1'))?.verificationDisabled).toBe(false)
  })

  it('passes identity and stats fields through unchanged', async () => {
    const result = await loadProfileContext('user-1')
    expect(result).toMatchObject({
      name: 'Ada',
      email: 'me@example.com',
      image: null,
      hasPassword: true,
      credentialEmail: 'me@example.com',
      isPro: true,
      stats: baseStats,
    })
    expect(Array.isArray(result?.accountTypes)).toBe(true)
    expect(Array.isArray(result?.availableEmails)).toBe(true)
  })

  it('returns null when the user row is missing', async () => {
    mockGetProfile.mockResolvedValue(null)
    expect(await loadProfileContext('user-1')).toBeNull()
  })
})
