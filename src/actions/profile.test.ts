import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/infra/resend', () => ({
  sendEmail: vi.fn(),
  parseEmailAddress: (value: string) => value,
  getNotificationRecipientEmail: () => 'admin@example.com',
}))

vi.mock('@/lib/auth/auth-service', () => ({
  verifyUserPasswordById: vi.fn(),
  changeUserPassword: vi.fn(),
}))

vi.mock('@/lib/db/profile', () => ({
  getProfileData: vi.fn(),
  updateUserEmail: vi.fn(),
  updateUserName: vi.fn(),
}))

vi.mock('@/lib/infra/cache', () => ({
  invalidateProfileCache: vi.fn(),
}))

const { mockGetSession, mockRateLimitAction } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRateLimitAction: vi.fn(),
}))

vi.mock('@/auth', () => ({
  signOut: vi.fn(async () => undefined),
}))

vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return {
    ...actual,
    rateLimitAction: mockRateLimitAction,
  }
})

vi.mock('@/lib/session', () => ({
  withAuth: async (fn: (ctx: { userId: string }) => Promise<unknown>) => {
    const session = await mockGetSession()
    if (!session?.user?.id) {
      return { status: 'unauthorized', data: null, message: 'Not authenticated.' }
    }
    return fn({ userId: session.user.id })
  },
  withAuthAndRateLimit: async (
    rateLimitKey: string,
    fn: (ctx: { userId: string }) => Promise<unknown>,
  ) => {
    const session = await mockGetSession()
    if (!session?.user?.id) {
      return { status: 'unauthorized', data: null, message: 'Not authenticated.' }
    }
    const rateLimit = await mockRateLimitAction(rateLimitKey, session.user.id)
    if (rateLimit) return rateLimit
    return fn({ userId: session.user.id })
  },
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing/lifecycle/stripe-billing-lifecycle', () => ({
  teardownStripeBillingForUser: vi.fn(),
  syncStripeCustomerEmailForUser: vi.fn(),
}))

vi.mock('@/lib/db/users', () => ({
  deleteUserById: vi.fn(),
  getUserAuthMethods: vi.fn(),
  getUserAuthInfoByEmail: vi.fn(),
  checkAccountExists: vi.fn(),
  unlinkUserAccount: vi.fn(),
  removeUserPassword: vi.fn(),
}))

vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}))

import { signOut } from '@/auth'
import { verifyUserPasswordById, changeUserPassword } from '@/lib/auth/auth-service'
import { getProfileData, updateUserName } from '@/lib/db/profile'
import { teardownStripeBillingForUser } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import {
  checkAccountExists,
  deleteUserById,
  getUserAuthMethods,
  unlinkUserAccount,
  removeUserPassword,
} from '@/lib/db/users'
import {
  changePasswordAction,
  deleteAccountAction,
  removeCredentialsAction,
  setInitialPasswordAction,
  unlinkProviderAction,
  updateMainEmailAction,
  updateNameAction,
} from './profile'

const mockTeardownStripeBillingForUser = teardownStripeBillingForUser as ReturnType<typeof vi.fn>
const mockDeleteUserById = deleteUserById as ReturnType<typeof vi.fn>
const mockSignOut = signOut as ReturnType<typeof vi.fn>
const mockVerifyUserPasswordById = verifyUserPasswordById as ReturnType<typeof vi.fn>
const mockChangeUserPassword = changeUserPassword as ReturnType<typeof vi.fn>
const mockGetUserAuthMethods = getUserAuthMethods as ReturnType<typeof vi.fn>
const mockCheckAccountExists = checkAccountExists as ReturnType<typeof vi.fn>
const mockUnlinkUserAccount = unlinkUserAccount as ReturnType<typeof vi.fn>
const mockRemoveUserPassword = removeUserPassword as ReturnType<typeof vi.fn>
const mockGetProfileData = getProfileData as ReturnType<typeof vi.fn>
const mockUpdateUserName = updateUserName as ReturnType<typeof vi.fn>

describe('updateNameAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateUserName.mockResolvedValue(undefined)
  })

  it('returns validation_error when name is empty', async () => {
    const form = new FormData()
    form.set('name', '   ')

    const result = await updateNameAction(null, form)

    expect(result.status).toBe('validation_error')
    expect(mockUpdateUserName).not.toHaveBeenCalled()
  })

  it('updates the user name when valid', async () => {
    const form = new FormData()
    form.set('name', 'Ada Lovelace')

    const result = await updateNameAction(null, form)

    expect(result.status).toBe('ok')
    expect(mockUpdateUserName).toHaveBeenCalledWith('user-1', 'Ada Lovelace')
  })
})

describe('removeCredentialsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserAuthMethods.mockResolvedValue({
      password: 'hashed',
      accounts: [{ id: 'acct-1' }],
    })
    mockVerifyUserPasswordById.mockResolvedValue(true)
    mockRemoveUserPassword.mockResolvedValue(undefined)
  })

  it('requires password confirmation', async () => {
    const result = await removeCredentialsAction()

    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Password is required')
    expect(mockRemoveUserPassword).not.toHaveBeenCalled()
  })

  it('rejects incorrect password', async () => {
    mockVerifyUserPasswordById.mockResolvedValue(false)

    const result = await removeCredentialsAction('wrong-password')

    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Incorrect password')
    expect(mockRemoveUserPassword).not.toHaveBeenCalled()
  })

  it('removes password when confirmation succeeds', async () => {
    const result = await removeCredentialsAction('correct-password')

    expect(result.status).toBe('ok')
    expect(mockRemoveUserPassword).toHaveBeenCalledWith('user-1')
  })

  it('blocks removing the only sign-in method', async () => {
    mockGetUserAuthMethods.mockResolvedValue({
      password: 'hashed',
      accounts: [],
    })

    const result = await removeCredentialsAction('correct-password')

    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('only sign-in method')
    expect(mockRemoveUserPassword).not.toHaveBeenCalled()
  })
})

describe('deleteAccountAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockRateLimitAction.mockResolvedValue(null)
    mockGetUserAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acct-1' }] })
    mockTeardownStripeBillingForUser.mockResolvedValue(undefined)
    mockDeleteUserById.mockResolvedValue(undefined)
  })

  it('returns unauthorized when not signed in', async () => {
    mockGetSession.mockResolvedValue(null)

    const result = await deleteAccountAction()

    expect(result.status).toBe('unauthorized')
    expect(mockTeardownStripeBillingForUser).not.toHaveBeenCalled()
  })

  it('returns internal_error when Stripe billing teardown fails', async () => {
    mockTeardownStripeBillingForUser.mockRejectedValue(new Error('Stripe unavailable'))

    const result = await deleteAccountAction()

    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('billing cleanup')
    expect(mockDeleteUserById).not.toHaveBeenCalled()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('deletes the user and signs out when billing teardown succeeds', async () => {
    const result = await deleteAccountAction()

    expect(result.status).toBe('ok')
    expect(mockTeardownStripeBillingForUser).toHaveBeenCalledWith('user-1')
    expect(mockDeleteUserById).toHaveBeenCalledWith('user-1')
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false })
  })

  it('requires password for credential users', async () => {
    mockGetUserAuthMethods.mockResolvedValue({ password: 'hashed', accounts: [] })

    const result = await deleteAccountAction()

    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Password is required')
    expect(mockTeardownStripeBillingForUser).not.toHaveBeenCalled()
  })

  it('returns too_many_requests when delete account rate limit is exceeded', async () => {
    mockRateLimitAction.mockResolvedValueOnce({
      status: 'too_many_requests',
      data: null,
      message: 'Too many attempts.',
    })

    const result = await deleteAccountAction()

    expect(result.status).toBe('too_many_requests')
    expect(mockTeardownStripeBillingForUser).not.toHaveBeenCalled()
  })
  it('returns internal_error when user deletion fails after billing teardown', async () => {
    mockDeleteUserById.mockRejectedValue(new Error('DB unavailable'))

    const result = await deleteAccountAction()

    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('account deletion failed')
    expect(mockSignOut).not.toHaveBeenCalled()
  })
})

describe('changePasswordAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockVerifyUserPasswordById.mockResolvedValue(true)
    mockChangeUserPassword.mockResolvedValue(undefined)
  })

  it('returns bad_request when current password is incorrect', async () => {
    mockVerifyUserPasswordById.mockResolvedValue(false)
    const form = new FormData()
    form.set('currentPassword', 'old-password')
    form.set('newPassword', 'new-password-1')
    form.set('confirmPassword', 'new-password-1')

    const result = await changePasswordAction(null, form)

    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Current password is incorrect')
    expect(mockChangeUserPassword).not.toHaveBeenCalled()
  })

  it('returns validation_error when passwords do not match', async () => {
    const form = new FormData()
    form.set('currentPassword', 'old-password')
    form.set('newPassword', 'new-password-1')
    form.set('confirmPassword', 'different-password')

    const result = await changePasswordAction(null, form)

    expect(result.status).toBe('validation_error')
    expect(mockChangeUserPassword).not.toHaveBeenCalled()
  })
})

describe('unlinkProviderAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('blocks unlinking the only sign-in method', async () => {
    mockGetUserAuthMethods.mockResolvedValue({
      password: null,
      accounts: [{ id: 'acct-1' }],
    })

    const result = await unlinkProviderAction('acct-1')

    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('only sign-in method')
    expect(mockUnlinkUserAccount).not.toHaveBeenCalled()
  })

  it('unlinks a provider when another sign-in method remains', async () => {
    mockGetUserAuthMethods.mockResolvedValue({
      password: 'hashed',
      accounts: [{ id: 'acct-1' }, { id: 'acct-2' }],
    })
    mockCheckAccountExists.mockResolvedValue({ id: 'acct-1' })

    const result = await unlinkProviderAction('acct-1')

    expect(result.status).toBe('ok')
    expect(mockUnlinkUserAccount).toHaveBeenCalledWith('user-1', 'acct-1')
  })
})

describe('updateMainEmailAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('forbids emails not owned by linked accounts', async () => {
    mockGetProfileData.mockResolvedValue({
      user: {
        email: 'primary@example.com',
        hasPassword: false,
        accounts: [{ email: 'linked@example.com' }],
      },
    })

    const result = await updateMainEmailAction('other@example.com')

    expect(result.status).toBe('forbidden')
  })

  it('requires password for credential users', async () => {
    mockGetProfileData.mockResolvedValue({
      user: {
        email: 'primary@example.com',
        hasPassword: true,
        accounts: [{ email: 'linked@example.com' }],
      },
    })

    const result = await updateMainEmailAction('linked@example.com')

    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Password is required')
  })

  it('rejects incorrect password for credential users', async () => {
    mockGetProfileData.mockResolvedValue({
      user: {
        email: 'primary@example.com',
        hasPassword: true,
        accounts: [{ email: 'linked@example.com' }],
      },
    })
    mockVerifyUserPasswordById.mockResolvedValue(false)

    const result = await updateMainEmailAction('linked@example.com', 'wrong-password')

    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Incorrect password')
  })
})

describe('setInitialPasswordAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserAuthMethods.mockResolvedValue({ password: null, accounts: [] })
    mockGetProfileData.mockResolvedValue({
      user: {
        email: 'primary@example.com',
        accounts: [{ email: 'linked@example.com' }],
      },
    })
  })

  it('forbids emails not owned by linked accounts', async () => {
    const form = new FormData()
    form.set('email', 'other@example.com')
    form.set('newPassword', 'new-password-1')
    form.set('confirmPassword', 'new-password-1')

    const result = await setInitialPasswordAction(null, form)

    expect(result.status).toBe('forbidden')
    expect(mockChangeUserPassword).not.toHaveBeenCalled()
  })
})
