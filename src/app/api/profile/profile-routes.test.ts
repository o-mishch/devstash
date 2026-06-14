import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn(async () => undefined) }))
vi.mock('@/lib/auth/auth-service', () => ({
  verifyUserPasswordById: vi.fn(),
  changeUserPassword: vi.fn(),
}))
vi.mock('@/lib/db/profile', () => ({
  getProfileData: vi.fn(),
  updateUserEmail: vi.fn(),
  updateUserName: vi.fn(),
}))
vi.mock('@/lib/db/users', () => ({
  deleteUserById: vi.fn(),
  getUserAuthMethods: vi.fn(),
  getUserAuthInfoByEmail: vi.fn(),
  checkAccountExists: vi.fn(),
  unlinkUserAccount: vi.fn(),
  removeUserPassword: vi.fn(),
}))
vi.mock('@/lib/infra/cache', () => ({ invalidateProfileCache: vi.fn() }))
vi.mock('@/lib/billing/lifecycle/stripe-billing-lifecycle', () => ({
  teardownStripeBillingForUser: vi.fn(),
  syncStripeCustomerEmailForUser: vi.fn(),
}))

const { mockRateLimitRoute } = vi.hoisted(() => ({ mockRateLimitRoute: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, rateLimitRoute: mockRateLimitRoute }
})

import { auth, signOut } from '@/auth'
import { verifyUserPasswordById, changeUserPassword } from '@/lib/auth/auth-service'
import { getProfileData, updateUserName } from '@/lib/db/profile'
import { teardownStripeBillingForUser } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { checkAccountExists, deleteUserById, getUserAuthMethods, unlinkUserAccount, removeUserPassword } from '@/lib/db/users'

import { PATCH as NAME } from './name/route'
import { PATCH as CHANGE_PASSWORD, POST as SET_PASSWORD } from './password/route'
import { DELETE as REMOVE_CREDENTIALS } from './credentials/route'
import { DELETE as DELETE_ACCOUNT } from './route'
import { DELETE as UNLINK } from './accounts/[id]/route'
import { PATCH as MAIN_EMAIL } from './main-email/route'

const mockAuth = auth as ReturnType<typeof vi.fn>
const mockSignOut = signOut as ReturnType<typeof vi.fn>
const mockVerifyUserPasswordById = verifyUserPasswordById as ReturnType<typeof vi.fn>
const mockChangeUserPassword = changeUserPassword as ReturnType<typeof vi.fn>
const mockGetProfileData = getProfileData as ReturnType<typeof vi.fn>
const mockUpdateUserName = updateUserName as ReturnType<typeof vi.fn>
const mockTeardownStripeBillingForUser = teardownStripeBillingForUser as ReturnType<typeof vi.fn>
const mockDeleteUserById = deleteUserById as ReturnType<typeof vi.fn>
const mockGetUserAuthMethods = getUserAuthMethods as ReturnType<typeof vi.fn>
const mockCheckAccountExists = checkAccountExists as ReturnType<typeof vi.fn>
const mockUnlinkUserAccount = unlinkUserAccount as ReturnType<typeof vi.fn>
const mockRemoveUserPassword = removeUserPassword as ReturnType<typeof vi.fn>

type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>

interface CallOptions {
  body?: unknown
  params?: Record<string, string>
}

async function call(handler: RouteHandler, method: string, { body, params }: CallOptions = {}) {
  const req = new NextRequest('http://localhost/api/profile', {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
  const res = await handler(req, { params: Promise.resolve(params ?? {}) })
  return res.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
  mockRateLimitRoute.mockResolvedValue(null)
})

describe('PATCH /api/profile/name', () => {
  beforeEach(() => mockUpdateUserName.mockResolvedValue(undefined))

  it('returns unauthorized when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(NAME, 'PATCH', { body: { name: 'Ada' } })).status).toBe('unauthorized')
  })

  it('returns validation_error when name is empty', async () => {
    const result = await call(NAME, 'PATCH', { body: { name: '   ' } })
    expect(result.status).toBe('validation_error')
    expect(mockUpdateUserName).not.toHaveBeenCalled()
  })

  it('updates the user name when valid', async () => {
    const result = await call(NAME, 'PATCH', { body: { name: 'Ada Lovelace' } })
    expect(result.status).toBe('ok')
    expect(mockUpdateUserName).toHaveBeenCalledWith('user-1', 'Ada Lovelace')
  })
})

describe('DELETE /api/profile/credentials', () => {
  beforeEach(() => {
    mockGetUserAuthMethods.mockResolvedValue({ password: 'hashed', accounts: [{ id: 'acct-1' }] })
    mockVerifyUserPasswordById.mockResolvedValue(true)
    mockRemoveUserPassword.mockResolvedValue(undefined)
  })

  it('requires password confirmation', async () => {
    const result = await call(REMOVE_CREDENTIALS, 'DELETE', { body: {} })
    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Password is required')
    expect(mockRemoveUserPassword).not.toHaveBeenCalled()
  })

  it('rejects incorrect password', async () => {
    mockVerifyUserPasswordById.mockResolvedValue(false)
    const result = await call(REMOVE_CREDENTIALS, 'DELETE', { body: { password: 'wrong-password' } })
    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Incorrect password')
    expect(mockRemoveUserPassword).not.toHaveBeenCalled()
  })

  it('removes password when confirmation succeeds', async () => {
    const result = await call(REMOVE_CREDENTIALS, 'DELETE', { body: { password: 'correct-password' } })
    expect(result.status).toBe('ok')
    expect(mockRemoveUserPassword).toHaveBeenCalledWith('user-1')
  })

  it('blocks removing the only sign-in method', async () => {
    mockGetUserAuthMethods.mockResolvedValue({ password: 'hashed', accounts: [] })
    const result = await call(REMOVE_CREDENTIALS, 'DELETE', { body: { password: 'correct-password' } })
    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('only sign-in method')
    expect(mockRemoveUserPassword).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/profile', () => {
  beforeEach(() => {
    mockGetUserAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acct-1' }] })
    mockTeardownStripeBillingForUser.mockResolvedValue(undefined)
    mockDeleteUserById.mockResolvedValue(undefined)
  })

  it('returns unauthorized when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await call(DELETE_ACCOUNT, 'DELETE', { body: {} })
    expect(result.status).toBe('unauthorized')
    expect(mockTeardownStripeBillingForUser).not.toHaveBeenCalled()
  })

  it('returns internal_error when Stripe billing teardown fails', async () => {
    mockTeardownStripeBillingForUser.mockRejectedValue(new Error('Stripe unavailable'))
    const result = await call(DELETE_ACCOUNT, 'DELETE', { body: {} })
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('billing cleanup')
    expect(mockDeleteUserById).not.toHaveBeenCalled()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('deletes the user and signs out when billing teardown succeeds', async () => {
    const result = await call(DELETE_ACCOUNT, 'DELETE', { body: {} })
    expect(result.status).toBe('ok')
    expect(mockTeardownStripeBillingForUser).toHaveBeenCalledWith('user-1')
    expect(mockDeleteUserById).toHaveBeenCalledWith('user-1')
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false })
  })

  it('requires password for credential users', async () => {
    mockGetUserAuthMethods.mockResolvedValue({ password: 'hashed', accounts: [] })
    const result = await call(DELETE_ACCOUNT, 'DELETE', { body: {} })
    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Password is required')
    expect(mockTeardownStripeBillingForUser).not.toHaveBeenCalled()
  })

  it('returns too_many_requests when delete account rate limit is exceeded', async () => {
    mockRateLimitRoute.mockResolvedValueOnce({ body: { status: 'too_many_requests', data: null, message: 'Too many attempts.' }, headers: {} })
    const result = await call(DELETE_ACCOUNT, 'DELETE', { body: {} })
    expect(result.status).toBe('too_many_requests')
    expect(mockTeardownStripeBillingForUser).not.toHaveBeenCalled()
  })

  it('returns internal_error when user deletion fails after billing teardown', async () => {
    mockDeleteUserById.mockRejectedValue(new Error('DB unavailable'))
    const result = await call(DELETE_ACCOUNT, 'DELETE', { body: {} })
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('account deletion failed')
    expect(mockSignOut).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/profile/password (change)', () => {
  beforeEach(() => {
    mockVerifyUserPasswordById.mockResolvedValue(true)
    mockChangeUserPassword.mockResolvedValue(undefined)
  })

  it('returns bad_request when current password is incorrect', async () => {
    mockVerifyUserPasswordById.mockResolvedValue(false)
    const result = await call(CHANGE_PASSWORD, 'PATCH', {
      body: { currentPassword: 'old-password', newPassword: 'new-password-1', confirmPassword: 'new-password-1' },
    })
    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Current password is incorrect')
    expect(mockChangeUserPassword).not.toHaveBeenCalled()
  })

  it('returns validation_error when passwords do not match', async () => {
    const result = await call(CHANGE_PASSWORD, 'PATCH', {
      body: { currentPassword: 'old-password', newPassword: 'new-password-1', confirmPassword: 'different-password' },
    })
    expect(result.status).toBe('validation_error')
    expect(mockChangeUserPassword).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/profile/accounts/[id]', () => {
  it('blocks unlinking the only sign-in method', async () => {
    mockGetUserAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acct-1' }] })
    const result = await call(UNLINK, 'DELETE', { params: { id: 'acct-1' } })
    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('only sign-in method')
    expect(mockUnlinkUserAccount).not.toHaveBeenCalled()
  })

  it('unlinks a provider when another sign-in method remains', async () => {
    mockGetUserAuthMethods.mockResolvedValue({ password: 'hashed', accounts: [{ id: 'acct-1' }, { id: 'acct-2' }] })
    mockCheckAccountExists.mockResolvedValue({ id: 'acct-1' })
    const result = await call(UNLINK, 'DELETE', { params: { id: 'acct-1' } })
    expect(result.status).toBe('ok')
    expect(mockUnlinkUserAccount).toHaveBeenCalledWith('user-1', 'acct-1')
  })
})

describe('PATCH /api/profile/main-email', () => {
  it('forbids emails not owned by linked accounts', async () => {
    mockGetProfileData.mockResolvedValue({ user: { email: 'primary@example.com', hasPassword: false, accounts: [{ email: 'linked@example.com' }] } })
    const result = await call(MAIN_EMAIL, 'PATCH', { body: { email: 'other@example.com' } })
    expect(result.status).toBe('forbidden')
  })

  it('requires password for credential users', async () => {
    mockGetProfileData.mockResolvedValue({ user: { email: 'primary@example.com', hasPassword: true, accounts: [{ email: 'linked@example.com' }] } })
    const result = await call(MAIN_EMAIL, 'PATCH', { body: { email: 'linked@example.com' } })
    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Password is required')
  })

  it('rejects incorrect password for credential users', async () => {
    mockGetProfileData.mockResolvedValue({ user: { email: 'primary@example.com', hasPassword: true, accounts: [{ email: 'linked@example.com' }] } })
    mockVerifyUserPasswordById.mockResolvedValue(false)
    const result = await call(MAIN_EMAIL, 'PATCH', { body: { email: 'linked@example.com', password: 'wrong-password' } })
    expect(result.status).toBe('bad_request')
    expect(result.message).toContain('Incorrect password')
  })
})

describe('POST /api/profile/password (set initial)', () => {
  beforeEach(() => {
    mockGetUserAuthMethods.mockResolvedValue({ password: null, accounts: [] })
    mockGetProfileData.mockResolvedValue({ user: { email: 'primary@example.com', accounts: [{ email: 'linked@example.com' }] } })
  })

  it('forbids emails not owned by linked accounts', async () => {
    const result = await call(SET_PASSWORD, 'POST', {
      body: { email: 'other@example.com', newPassword: 'new-password-1', confirmPassword: 'new-password-1' },
    })
    expect(result.status).toBe('forbidden')
    expect(mockChangeUserPassword).not.toHaveBeenCalled()
  })
})
