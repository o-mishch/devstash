import { vi, describe, it, expect, beforeEach } from 'vitest'
import { invoke, expectORPCError } from '@/test/orpc'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, checkRateLimit: vi.fn() }
})
vi.mock('@/auth', () => ({ signOut: vi.fn(async () => undefined) }))
vi.mock('@/lib/auth/auth-service', () => ({ verifyUserPasswordById: vi.fn(), changeUserPassword: vi.fn() }))
vi.mock('@/lib/db/profile', () => ({
  getProfileData: vi.fn(),
  updateUserName: vi.fn(),
  updateEditorPreferences: vi.fn(),
  updateUserEmail: vi.fn(),
}))
vi.mock('@/lib/db/users', () => ({
  getUserAuthMethods: vi.fn(),
  deleteUserById: vi.fn(),
  removeUserPassword: vi.fn(),
  checkAccountExists: vi.fn(),
  unlinkUserAccount: vi.fn(),
  getUserAuthInfoByEmail: vi.fn(),
}))
vi.mock('@/lib/billing/lifecycle/stripe-billing-lifecycle', () => ({
  teardownStripeBillingForUser: vi.fn(),
  syncStripeCustomerEmailForUser: vi.fn(),
}))
vi.mock('@/lib/infra/cache', () => ({ invalidateProfileCache: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { signOut } from '@/auth'
import { verifyUserPasswordById, changeUserPassword } from '@/lib/auth/auth-service'
import { getProfileData, updateUserName } from '@/lib/db/profile'
import { teardownStripeBillingForUser } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { getUserAuthMethods, deleteUserById, checkAccountExists, unlinkUserAccount, removeUserPassword } from '@/lib/db/users'
import { profileRouter } from './profile'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockSignOut = signOut as ReturnType<typeof vi.fn>
const mockVerifyPassword = verifyUserPasswordById as ReturnType<typeof vi.fn>
const mockChangePassword = changeUserPassword as ReturnType<typeof vi.fn>
const mockGetProfileData = getProfileData as ReturnType<typeof vi.fn>
const mockUpdateUserName = updateUserName as ReturnType<typeof vi.fn>
const mockTeardownStripe = teardownStripeBillingForUser as ReturnType<typeof vi.fn>
const mockDeleteUserById = deleteUserById as ReturnType<typeof vi.fn>
const mockGetUserAuthMethods = getUserAuthMethods as ReturnType<typeof vi.fn>
const mockCheckAccountExists = checkAccountExists as ReturnType<typeof vi.fn>
const mockUnlinkAccount = unlinkUserAccount as ReturnType<typeof vi.fn>
const mockRemovePassword = removeUserPassword as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(false)
  mockCheckRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
})

describe('profile.updateName', () => {
  beforeEach(() => mockUpdateUserName.mockResolvedValue(undefined))

  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(profileRouter.updateName, { name: 'Ada' }), 'UNAUTHORIZED')
  })

  it('rejects an empty name', async () => {
    await expectORPCError(invoke(profileRouter.updateName, { name: '   ' }), 'BAD_REQUEST')
    expect(mockUpdateUserName).not.toHaveBeenCalled()
  })

  it('updates the user name when valid', async () => {
    await invoke(profileRouter.updateName, { name: 'Ada Lovelace' })
    expect(mockUpdateUserName).toHaveBeenCalledWith('user-1', 'Ada Lovelace')
  })
})

describe('profile.removeCredentials', () => {
  beforeEach(() => {
    mockGetUserAuthMethods.mockResolvedValue({ password: 'hashed', accounts: [{ id: 'acct-1' }] })
    mockVerifyPassword.mockResolvedValue(true)
    mockRemovePassword.mockResolvedValue(undefined)
  })

  it('requires password confirmation', async () => {
    await expectORPCError(invoke(profileRouter.removeCredentials, {}), 'BAD_REQUEST')
    expect(mockRemovePassword).not.toHaveBeenCalled()
  })

  it('rejects an incorrect password', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    await expectORPCError(invoke(profileRouter.removeCredentials, { password: 'wrong-password' }), 'BAD_REQUEST')
    expect(mockRemovePassword).not.toHaveBeenCalled()
  })

  it('removes the password when confirmation succeeds', async () => {
    await invoke(profileRouter.removeCredentials, { password: 'correct-password' })
    expect(mockRemovePassword).toHaveBeenCalledWith('user-1')
  })

  it('blocks removing the only sign-in method', async () => {
    mockGetUserAuthMethods.mockResolvedValue({ password: 'hashed', accounts: [] })
    await expectORPCError(invoke(profileRouter.removeCredentials, { password: 'correct-password' }), 'BAD_REQUEST')
    expect(mockRemovePassword).not.toHaveBeenCalled()
  })
})

describe('profile.deleteAccount', () => {
  beforeEach(() => {
    mockGetUserAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acct-1' }] })
    mockTeardownStripe.mockResolvedValue(undefined)
    mockDeleteUserById.mockResolvedValue(undefined)
  })

  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(profileRouter.deleteAccount, {}), 'UNAUTHORIZED')
    expect(mockTeardownStripe).not.toHaveBeenCalled()
  })

  it('throws INTERNAL_SERVER_ERROR when Stripe billing teardown fails', async () => {
    mockTeardownStripe.mockRejectedValue(new Error('Stripe unavailable'))
    await expectORPCError(invoke(profileRouter.deleteAccount, {}), 'INTERNAL_SERVER_ERROR')
    expect(mockDeleteUserById).not.toHaveBeenCalled()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('deletes the user and signs out when billing teardown succeeds', async () => {
    await invoke(profileRouter.deleteAccount, {})
    expect(mockTeardownStripe).toHaveBeenCalledWith('user-1')
    expect(mockDeleteUserById).toHaveBeenCalledWith('user-1')
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false })
  })

  it('requires a password for credential users', async () => {
    mockGetUserAuthMethods.mockResolvedValue({ password: 'hashed', accounts: [] })
    await expectORPCError(invoke(profileRouter.deleteAccount, {}), 'BAD_REQUEST')
    expect(mockTeardownStripe).not.toHaveBeenCalled()
  })

  it('throws TOO_MANY_REQUESTS when the delete-account rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(profileRouter.deleteAccount, {}), 'TOO_MANY_REQUESTS')
    expect(mockTeardownStripe).not.toHaveBeenCalled()
  })

  it('throws INTERNAL_SERVER_ERROR when user deletion fails after billing teardown', async () => {
    mockDeleteUserById.mockRejectedValue(new Error('DB unavailable'))
    await expectORPCError(invoke(profileRouter.deleteAccount, {}), 'INTERNAL_SERVER_ERROR')
    expect(mockSignOut).not.toHaveBeenCalled()
  })
})

describe('profile.changePassword', () => {
  beforeEach(() => {
    mockVerifyPassword.mockResolvedValue(true)
    mockChangePassword.mockResolvedValue(undefined)
  })

  it('throws BAD_REQUEST when the current password is incorrect', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    await expectORPCError(invoke(profileRouter.changePassword, {
      currentPassword: 'old-password', newPassword: 'new-password-1', confirmPassword: 'new-password-1',
    }), 'BAD_REQUEST')
    expect(mockChangePassword).not.toHaveBeenCalled()
  })

  it('rejects when the new passwords do not match', async () => {
    await expectORPCError(invoke(profileRouter.changePassword, {
      currentPassword: 'old-password', newPassword: 'new-password-1', confirmPassword: 'different-password',
    }), 'BAD_REQUEST')
    expect(mockChangePassword).not.toHaveBeenCalled()
  })
})

describe('profile.unlinkAccount', () => {
  it('blocks unlinking the only sign-in method', async () => {
    mockGetUserAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acct-1' }] })
    await expectORPCError(invoke(profileRouter.unlinkAccount, { id: 'acct-1' }), 'BAD_REQUEST')
    expect(mockUnlinkAccount).not.toHaveBeenCalled()
  })

  it('unlinks a provider when another sign-in method remains', async () => {
    mockGetUserAuthMethods.mockResolvedValue({ password: 'hashed', accounts: [{ id: 'acct-1' }, { id: 'acct-2' }] })
    mockCheckAccountExists.mockResolvedValue({ id: 'acct-1' })
    await invoke(profileRouter.unlinkAccount, { id: 'acct-1' })
    expect(mockUnlinkAccount).toHaveBeenCalledWith('user-1', 'acct-1')
  })
})

describe('profile.updateMainEmail', () => {
  it('forbids emails not owned by linked accounts', async () => {
    mockGetProfileData.mockResolvedValue({ user: { email: 'primary@example.com', hasPassword: false, accounts: [{ email: 'linked@example.com' }] } })
    await expectORPCError(invoke(profileRouter.updateMainEmail, { email: 'other@example.com' }), 'FORBIDDEN')
  })

  it('requires a password for credential users', async () => {
    mockGetProfileData.mockResolvedValue({ user: { email: 'primary@example.com', hasPassword: true, accounts: [{ email: 'linked@example.com' }] } })
    await expectORPCError(invoke(profileRouter.updateMainEmail, { email: 'linked@example.com' }), 'BAD_REQUEST')
  })

  it('rejects an incorrect password for credential users', async () => {
    mockGetProfileData.mockResolvedValue({ user: { email: 'primary@example.com', hasPassword: true, accounts: [{ email: 'linked@example.com' }] } })
    mockVerifyPassword.mockResolvedValue(false)
    await expectORPCError(invoke(profileRouter.updateMainEmail, { email: 'linked@example.com', password: 'wrong-password' }), 'BAD_REQUEST')
  })
})

describe('profile.setInitialPassword', () => {
  beforeEach(() => {
    mockGetUserAuthMethods.mockResolvedValue({ password: null, accounts: [] })
    mockGetProfileData.mockResolvedValue({ user: { email: 'primary@example.com', accounts: [{ email: 'linked@example.com' }] } })
  })

  it('forbids emails not owned by linked accounts', async () => {
    await expectORPCError(invoke(profileRouter.setInitialPassword, {
      email: 'other@example.com', newPassword: 'new-password-1', confirmPassword: 'new-password-1',
    }), 'FORBIDDEN')
    expect(mockChangePassword).not.toHaveBeenCalled()
  })
})
