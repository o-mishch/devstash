import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Route handlers are tested by invoking the exported handler with a mocked NextRequest and asserting
// res.status. The real profile-helpers run through the handlers (db/auth/billing mocked beneath).
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({ invalidateProfileCache: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  deniedMessage: vi.fn((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('@/auth', () => ({ signOut: vi.fn() }))
vi.mock('@/lib/db/users', () => ({
  getUserAuthMethods: vi.fn(),
  deleteUserById: vi.fn(),
  removeUserPassword: vi.fn(),
  checkAccountExists: vi.fn(),
  unlinkUserAccount: vi.fn(),
  getUserAuthInfoByEmail: vi.fn(),
}))
vi.mock('@/lib/db/profile', () => ({
  updateUserName: vi.fn(),
  updateEditorPreferences: vi.fn(),
  getProfileData: vi.fn(),
  updateUserEmail: vi.fn(),
}))
vi.mock('@/lib/auth/auth-service', () => ({ changeUserPassword: vi.fn(), setInitialUserPassword: vi.fn(), verifyUserPasswordById: vi.fn() }))
vi.mock('@/lib/emails/security-notification', () => ({ sendSecurityNotification: vi.fn() }))
vi.mock('@/lib/billing/lifecycle/stripe-billing-lifecycle', () => ({
  teardownStripeBillingForUser: vi.fn(),
  syncStripeCustomerEmailForUser: vi.fn(),
}))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import {
  getUserAuthMethods,
  deleteUserById,
  removeUserPassword,
  checkAccountExists,
  unlinkUserAccount,
  getUserAuthInfoByEmail,
} from '@/lib/db/users'
import { updateUserName, getProfileData, updateUserEmail } from '@/lib/db/profile'
import { changeUserPassword, setInitialUserPassword, verifyUserPasswordById } from '@/lib/auth/auth-service'
import { sendSecurityNotification } from '@/lib/emails/security-notification'
import { teardownStripeBillingForUser } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'

import { DELETE as DELETE_ACCOUNT } from './route'
import { PATCH as PATCH_NAME } from './name/route'
import { PATCH as PATCH_PREFS } from './editor-preferences/route'
import { PATCH as CHANGE_PASSWORD, POST as SET_PASSWORD } from './password/route'
import { DELETE as REMOVE_CREDENTIALS } from './credentials/route'
import { PATCH as CHANGE_EMAIL } from './email/route'
import { PATCH as UPDATE_MAIN_EMAIL } from './main-email/route'
import { DELETE as UNLINK_ACCOUNT } from './accounts/[id]/route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockAuthMethods = getUserAuthMethods as ReturnType<typeof vi.fn>
const mockDeleteUser = deleteUserById as ReturnType<typeof vi.fn>
const mockRemovePassword = removeUserPassword as ReturnType<typeof vi.fn>
const mockCheckAccount = checkAccountExists as ReturnType<typeof vi.fn>
const mockUnlink = unlinkUserAccount as ReturnType<typeof vi.fn>
const mockAuthInfoByEmail = getUserAuthInfoByEmail as ReturnType<typeof vi.fn>
const mockUpdateName = updateUserName as ReturnType<typeof vi.fn>
const mockGetProfile = getProfileData as ReturnType<typeof vi.fn>
const mockUpdateEmail = updateUserEmail as ReturnType<typeof vi.fn>
const mockChangePassword = changeUserPassword as ReturnType<typeof vi.fn>
const mockSetInitialPassword = setInitialUserPassword as ReturnType<typeof vi.fn>
const mockVerifyPassword = verifyUserPasswordById as ReturnType<typeof vi.fn>
const mockNotify = sendSecurityNotification as ReturnType<typeof vi.fn>
const mockTeardown = teardownStripeBillingForUser as ReturnType<typeof vi.fn>

const OWNED_EMAIL = 'owned@google.com'

function req(method: string, payload?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/profile', {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(false)
  mockRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  mockVerifyPassword.mockResolvedValue(true)
  mockAuthMethods.mockResolvedValue({ password: 'hash', accounts: [{ id: 'acc-1', provider: 'google' }] })
  mockAuthInfoByEmail.mockResolvedValue(null)
  mockCheckAccount.mockResolvedValue({ id: 'acc-1' })
  mockGetProfile.mockResolvedValue({
    user: { email: 'me@example.com', hasPassword: true, accounts: [{ id: 'acc-1', provider: 'google', email: OWNED_EMAIL }] },
  })
})

describe('DELETE /profile', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await DELETE_ACCOUNT(req('DELETE', {}))
    expect(res.status).toBe(401)
  })

  it('returns 204 for an OAuth-only account (no password required)', async () => {
    mockAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acc-1', provider: 'google' }] })
    const res = await DELETE_ACCOUNT(req('DELETE', {}))
    expect(res.status).toBe(204)
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1')
  })

  it('returns 400 when the password is wrong', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    const res = await DELETE_ACCOUNT(req('DELETE', { password: 'nope' }))
    expect(res.status).toBe(400)
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it('returns 204 with the correct password', async () => {
    const res = await DELETE_ACCOUNT(req('DELETE', { password: 'password123' }))
    expect(res.status).toBe(204)
  })

  it('returns 500 when billing teardown fails', async () => {
    mockAuthMethods.mockResolvedValue({ password: null, accounts: [] })
    mockTeardown.mockRejectedValue(new Error('stripe down'))
    const res = await DELETE_ACCOUNT(req('DELETE', {}))
    expect(res.status).toBe(500)
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })
})

describe('PATCH /profile/name', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await PATCH_NAME(req('PATCH', { name: 'New' }))
    expect(res.status).toBe(401)
  })

  it('returns 422 for an empty name', async () => {
    const res = await PATCH_NAME(req('PATCH', { name: '   ' }))
    expect(res.status).toBe(422)
  })

  it('returns 204 and updates scoped to the session userId', async () => {
    const res = await PATCH_NAME(req('PATCH', { name: 'New Name' }))
    expect(res.status).toBe(204)
    expect(mockUpdateName).toHaveBeenCalledWith('user-1', 'New Name')
  })
})

describe('PATCH /profile/editor-preferences', () => {
  it('returns 422 for out-of-range values', async () => {
    const res = await PATCH_PREFS(req('PATCH', { fontSize: 999, tabSize: 2, wordWrap: 'on', minimap: false, theme: 'vs-dark', appTheme: 'dark' }))
    expect(res.status).toBe(422)
  })
})

describe('PATCH /profile/password (change)', () => {
  it('returns 422 when confirmation does not match', async () => {
    const res = await CHANGE_PASSWORD(req('PATCH', { currentPassword: 'old12345', newPassword: 'new12345', confirmPassword: 'different' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 when the current password is wrong', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    const res = await CHANGE_PASSWORD(req('PATCH', { currentPassword: 'wrong123', newPassword: 'new12345', confirmPassword: 'new12345' }))
    expect(res.status).toBe(400)
    expect(mockChangePassword).not.toHaveBeenCalled()
  })

  it('returns 204 on success', async () => {
    const res = await CHANGE_PASSWORD(req('PATCH', { currentPassword: 'old12345', newPassword: 'new12345', confirmPassword: 'new12345' }))
    expect(res.status).toBe(204)
    expect(mockChangePassword).toHaveBeenCalledWith('user-1', 'new12345')
  })
})

describe('POST /profile/password (set initial)', () => {
  it('returns 409 when a password is already set', async () => {
    const res = await SET_PASSWORD(req('POST', { email: OWNED_EMAIL, newPassword: 'new12345', confirmPassword: 'new12345' }))
    expect(res.status).toBe(409)
  })

  it('returns 403 when the email is not owned by the user', async () => {
    mockAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acc-1', provider: 'google' }] })
    const res = await SET_PASSWORD(req('POST', { email: 'stranger@evil.com', newPassword: 'new12345', confirmPassword: 'new12345' }))
    expect(res.status).toBe(403)
  })

  it('sets password + emailVerified via setInitialUserPassword when no password and email owned (Case 1 twin)', async () => {
    mockAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acc-1', provider: 'google' }] })
    const res = await SET_PASSWORD(req('POST', { email: OWNED_EMAIL, newPassword: 'new12345', confirmPassword: 'new12345' }))
    expect(res.status).toBe(204)
    expect(mockSetInitialPassword).toHaveBeenCalledWith('user-1', 'new12345')
    expect(mockChangePassword).not.toHaveBeenCalled()
  })
})

describe('DELETE /profile/credentials', () => {
  it('returns 400 when no password is set', async () => {
    mockAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acc-1', provider: 'google' }] })
    const res = await REMOVE_CREDENTIALS(req('DELETE', { password: 'password123' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when password is the only sign-in method', async () => {
    mockAuthMethods.mockResolvedValue({ password: 'hash', accounts: [] })
    const res = await REMOVE_CREDENTIALS(req('DELETE', { password: 'password123' }))
    expect(res.status).toBe(400)
  })

  it('returns 204 on success and notifies the owner (Case 7)', async () => {
    const res = await REMOVE_CREDENTIALS(req('DELETE', { password: 'password123' }))
    expect(res.status).toBe(204)
    expect(mockRemovePassword).toHaveBeenCalledWith('user-1')
    expect(mockNotify).toHaveBeenCalledWith('user-1', 'password-removed')
  })
})

describe('PATCH /profile/email', () => {
  it('returns 400 when no password is set', async () => {
    mockAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acc-1', provider: 'google' }] })
    const res = await CHANGE_EMAIL(req('PATCH', { email: OWNED_EMAIL, password: 'password123' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the password is wrong', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    const res = await CHANGE_EMAIL(req('PATCH', { email: OWNED_EMAIL, password: 'wrong123' }))
    expect(res.status).toBe(400)
  })

  it('returns 204 on success', async () => {
    const res = await CHANGE_EMAIL(req('PATCH', { email: OWNED_EMAIL, password: 'password123' }))
    expect(res.status).toBe(204)
    expect(mockUpdateEmail).toHaveBeenCalledWith('user-1', OWNED_EMAIL)
  })
})

describe('PATCH /profile/main-email', () => {
  it('returns 401 when the profile row is missing', async () => {
    mockGetProfile.mockResolvedValue(null)
    const res = await UPDATE_MAIN_EMAIL(req('PATCH', { email: OWNED_EMAIL }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when hasPassword and the password is wrong', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    const res = await UPDATE_MAIN_EMAIL(req('PATCH', { email: OWNED_EMAIL, password: 'wrong123' }))
    expect(res.status).toBe(400)
  })

  it('returns 204 for a no-password account', async () => {
    mockGetProfile.mockResolvedValue({
      user: { email: 'me@example.com', hasPassword: false, accounts: [{ id: 'acc-1', provider: 'google', email: OWNED_EMAIL }] },
    })
    const res = await UPDATE_MAIN_EMAIL(req('PATCH', { email: OWNED_EMAIL }))
    expect(res.status).toBe(204)
    expect(mockUpdateEmail).toHaveBeenCalledWith('user-1', OWNED_EMAIL)
  })
})

describe('DELETE /profile/accounts/{id}', () => {
  it('returns 400 when it is the only sign-in method', async () => {
    mockAuthMethods.mockResolvedValue({ password: null, accounts: [{ id: 'acc-1', provider: 'google' }] })
    const res = await UNLINK_ACCOUNT(req('DELETE'), params('acc-1'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the account does not exist', async () => {
    mockCheckAccount.mockResolvedValue(null)
    const res = await UNLINK_ACCOUNT(req('DELETE'), params('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 204, unlinks scoped to the session userId, and notifies the owner (Case 7)', async () => {
    const res = await UNLINK_ACCOUNT(req('DELETE'), params('acc-1'))
    expect(res.status).toBe(204)
    expect(mockUnlink).toHaveBeenCalledWith('user-1', 'acc-1')
    expect(mockNotify).toHaveBeenCalledWith('user-1', 'method-unlinked')
  })
})
