import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readJson } from '@/test/matchers'
import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma'

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
  removeCredentialLogin: vi.fn(),
  checkAccountExists: vi.fn(),
  unlinkUserAccount: vi.fn(),
  isEmailTakenByAnotherUser: vi.fn(),
  getUserProfile: vi.fn(),
}))
vi.mock('@/lib/db/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/profile')>()
  return {
    updateUserName: vi.fn(),
    updateEditorPreferences: vi.fn(),
    getProfileData: vi.fn(),
    updateUserEmail: vi.fn(),
    getEditorPreferences: vi.fn(),
    buildOwnedEmails: actual.buildOwnedEmails,
    getProfileAccountSummary: actual.getProfileAccountSummary,
  }
})
vi.mock('@/lib/db/usage', () => ({
  canCreateItem: vi.fn(),
  canCreateCollection: vi.fn(),
}))
vi.mock('@/lib/auth/auth-service', () => ({ changeUserPassword: vi.fn(), verifyUserPasswordById: vi.fn(), requestCredentialEmail: vi.fn() }))
vi.mock('@/lib/emails/security-notification', () => ({ sendSecurityNotification: vi.fn() }))
vi.mock('@/lib/billing/lifecycle/stripe-billing-lifecycle', () => ({
  teardownStripeBillingForUser: vi.fn(),
  syncStripeCustomerEmailForUserSafe: vi.fn(),
}))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import {
  getUserAuthMethods,
  deleteUserById,
  removeCredentialLogin,
  checkAccountExists,
  unlinkUserAccount,
  isEmailTakenByAnotherUser,
  getUserProfile,
} from '@/lib/db/users'
import { updateUserName, getProfileData, updateUserEmail, getEditorPreferences } from '@/lib/db/profile'
import { canCreateItem, canCreateCollection } from '@/lib/db/usage'
import { changeUserPassword, verifyUserPasswordById, requestCredentialEmail } from '@/lib/auth/auth-service'
import { sendSecurityNotification } from '@/lib/emails/security-notification'
import { teardownStripeBillingForUser, syncStripeCustomerEmailForUserSafe } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'

import { GET as GET_PROFILE, DELETE as DELETE_ACCOUNT } from './route'
import { GET as GET_PROFILE_ME } from './me/route'
import { GET as GET_EDITOR_PREFS, PATCH as PATCH_PREFS } from './editor-preferences/route'
import { PATCH as PATCH_NAME } from './name/route'
import { PATCH as CHANGE_PASSWORD } from './password/route'
import { DELETE as REMOVE_CREDENTIALS } from './credentials/route'
import { POST as REQUEST_CREDENTIAL_EMAIL } from './credential-email/route'
import { PATCH as UPDATE_MAIN_EMAIL } from './main-email/route'
import { DELETE as UNLINK_ACCOUNT } from './accounts/[id]/route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockAuthMethods = getUserAuthMethods as ReturnType<typeof vi.fn>
const mockDeleteUser = deleteUserById as ReturnType<typeof vi.fn>
const mockRemoveCredentialLogin = removeCredentialLogin as ReturnType<typeof vi.fn>
const mockCheckAccount = checkAccountExists as ReturnType<typeof vi.fn>
const mockUnlink = unlinkUserAccount as ReturnType<typeof vi.fn>
const mockIsEmailTaken = isEmailTakenByAnotherUser as ReturnType<typeof vi.fn>
const mockUpdateName = updateUserName as ReturnType<typeof vi.fn>
const mockGetProfile = getProfileData as ReturnType<typeof vi.fn>
const mockUpdateEmail = updateUserEmail as ReturnType<typeof vi.fn>
const mockChangePassword = changeUserPassword as ReturnType<typeof vi.fn>
const mockRequestCredentialEmail = requestCredentialEmail as ReturnType<typeof vi.fn>
const mockVerifyPassword = verifyUserPasswordById as ReturnType<typeof vi.fn>
const mockNotify = sendSecurityNotification as ReturnType<typeof vi.fn>
const mockTeardown = teardownStripeBillingForUser as ReturnType<typeof vi.fn>
const mockSyncStripeEmail = syncStripeCustomerEmailForUserSafe as ReturnType<typeof vi.fn>
const mockGetUserProfile = getUserProfile as ReturnType<typeof vi.fn>
const mockCanCreateItem = canCreateItem as ReturnType<typeof vi.fn>
const mockCanCreateCollection = canCreateCollection as ReturnType<typeof vi.fn>
const mockGetEditorPrefs = getEditorPreferences as ReturnType<typeof vi.fn>

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
  mockAuthMethods.mockResolvedValue({ email: 'me@example.com', credentialEmail: null, password: 'hash', accounts: [{ id: 'acc-1', provider: 'google', email: OWNED_EMAIL }] })
  mockIsEmailTaken.mockResolvedValue(false)
  mockCheckAccount.mockResolvedValue({ id: 'acc-1' })
  mockGetUserProfile.mockResolvedValue({ name: 'me', email: 'me@example.com', image: 'img' })
  mockCanCreateItem.mockResolvedValue(true)
  mockCanCreateCollection.mockResolvedValue(true)
  mockGetEditorPrefs.mockResolvedValue(null)
  mockGetProfile.mockResolvedValue({
    user: {
      id: 'user-1',
      name: 'me',
      email: 'me@example.com',
      credentialEmail: null,
      credentialEmailVerified: null,
      image: 'img',
      hasPassword: true,
      accounts: [{ id: 'acc-1', provider: 'google', email: OWNED_EMAIL }],
      createdAt: new Date('2026-06-24T00:00:00.000Z'),
      isPro: false,
    },
    stats: {
      totalItems: 0,
      totalCollections: 0,
      itemTypeCounts: [],
    },
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
    const res = await PATCH_PREFS(req('PATCH', {
      fontSize: 999,
      tabSize: 2,
      wordWrap: 'on',
      minimap: false,
      appTheme: 'modern-minimal',
      colorMode: 'dark',
      editorThemeMode: 'auto',
    }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for an unknown appTheme slug (e.g. old removed theme)', async () => {
    const res = await PATCH_PREFS(req('PATCH', {
      fontSize: 14,
      tabSize: 2,
      wordWrap: 'off',
      minimap: false,
      appTheme: 'vscode',
      colorMode: 'dark',
      editorThemeMode: 'auto',
    }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for an invalid colorMode value', async () => {
    const res = await PATCH_PREFS(req('PATCH', {
      fontSize: 14,
      tabSize: 2,
      wordWrap: 'off',
      minimap: false,
      appTheme: 'modern-minimal',
      colorMode: 'auto',
      editorThemeMode: 'auto',
    }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for an invalid editorThemeMode value', async () => {
    const res = await PATCH_PREFS(req('PATCH', {
      fontSize: 14,
      tabSize: 2,
      wordWrap: 'off',
      minimap: false,
      appTheme: 'modern-minimal',
      colorMode: 'dark',
      editorThemeMode: 'invalid',
    }))
    expect(res.status).toBe(422)
  })

  it('returns 204 on success with valid values', async () => {
    const res = await PATCH_PREFS(req('PATCH', {
      fontSize: 14,
      tabSize: 2,
      wordWrap: 'off',
      minimap: false,
      appTheme: 'modern-minimal',
      colorMode: 'dark',
      editorThemeMode: 'app',
      uiSkin: 'classic',
      sidebarCollapsed: false,
    }))
    expect(res.status).toBe(204)
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

  it('clears the credential login, keeps a normal primary email, and notifies the owner', async () => {
    // Primary email is not the credential email, so it is left untouched even though it isn't a linked
    // address (credentialEmail null here).
    const res = await REMOVE_CREDENTIALS(req('DELETE', { password: 'password123' }))
    expect(res.status).toBe(204)
    expect(mockRemoveCredentialLogin).toHaveBeenCalledWith('user-1', 'me@example.com')
    expect(mockSyncStripeEmail).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith('user-1', 'password-removed')
  })

  it('moves the primary email to a linked account when the primary IS the credential email', async () => {
    const credEmail = 'login@custom.com'
    mockAuthMethods.mockResolvedValue({
      email: credEmail,
      credentialEmail: credEmail,
      password: 'hash',
      accounts: [{ id: 'acc-1', provider: 'google', email: OWNED_EMAIL }],
    })
    const res = await REMOVE_CREDENTIALS(req('DELETE', { password: 'password123' }))
    expect(res.status).toBe(204)
    expect(mockRemoveCredentialLogin).toHaveBeenCalledWith('user-1', OWNED_EMAIL)
    expect(mockSyncStripeEmail).toHaveBeenCalledWith('user-1', OWNED_EMAIL)
  })

  it('returns 400 when the primary is the credential email but no linked OAuth email can replace it', async () => {
    const credEmail = 'login@custom.com'
    mockAuthMethods.mockResolvedValue({
      email: credEmail,
      credentialEmail: credEmail,
      password: 'hash',
      accounts: [{ id: 'acc-1', provider: 'google', email: null }],
    })
    const res = await REMOVE_CREDENTIALS(req('DELETE', { password: 'password123' }))
    expect(res.status).toBe(400)
    expect(mockRemoveCredentialLogin).not.toHaveBeenCalled()
  })
})

describe('POST /profile/credential-email', () => {
  // No existing password → first-time ADD (no re-auth possible/needed). The beforeEach default has a
  // password, i.e. a CHANGE, which requires re-auth.
  const asAdd = () => mockAuthMethods.mockResolvedValue({ email: 'me@example.com', credentialEmail: null, password: null, accounts: [{ id: 'acc-1', provider: 'google', email: OWNED_EMAIL }] })
  const CURRENT_PW = 'current-pw-123'

  it('CHANGE: returns 204 when a confirmation link is sent (re-auth ok)', async () => {
    mockRequestCredentialEmail.mockResolvedValue({ result: 'sent' })
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'new@example.com', password: CURRENT_PW }))
    expect(res.status).toBe(204)
    expect(mockRequestCredentialEmail).toHaveBeenCalledWith('user-1', 'new@example.com', undefined)
  })

  it('ADD: returns 204 when a confirmation link is sent (no re-auth)', async () => {
    asAdd()
    mockRequestCredentialEmail.mockResolvedValue({ result: 'sent' })
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'new@example.com' }))
    expect(res.status).toBe(204)
    expect(mockRequestCredentialEmail).toHaveBeenCalledWith('user-1', 'new@example.com', undefined)
  })

  it('returns 503 when the confirmation email cannot be sent', async () => {
    mockRequestCredentialEmail.mockResolvedValue({ result: 'send-failed' })
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'new@example.com', password: CURRENT_PW }))
    expect(res.status).toBe(503)
  })

  it('CHANGE: returns 400 without the current password', async () => {
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'new@example.com' }))
    expect(res.status).toBe(400)
    expect(mockRequestCredentialEmail).not.toHaveBeenCalled()
  })

  it('CHANGE: returns 400 when the current password is incorrect', async () => {
    mockVerifyPassword.mockResolvedValue(false)
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'new@example.com', password: 'wrong-pw-123' }))
    expect(res.status).toBe(400)
    expect(mockRequestCredentialEmail).not.toHaveBeenCalled()
  })

  it('ADD: returns 204 and passes the new password through when activating instantly', async () => {
    asAdd()
    mockRequestCredentialEmail.mockResolvedValue({ result: 'activated' })
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'new@example.com', newPassword: 'pass1234', confirmPassword: 'pass1234' }))
    expect(res.status).toBe(204)
    expect(mockRequestCredentialEmail).toHaveBeenCalledWith('user-1', 'new@example.com', 'pass1234')
  })

  it('ADD: returns 422 when the instant activation password is too short', async () => {
    asAdd()
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'new@example.com', newPassword: 'short', confirmPassword: 'short' }))
    expect(res.status).toBe(422)
    expect(mockRequestCredentialEmail).not.toHaveBeenCalled()
  })

  it('ADD: returns 422 when the instant path needs a password', async () => {
    asAdd()
    mockRequestCredentialEmail.mockResolvedValue({ result: 'password-required' })
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'new@example.com' }))
    expect(res.status).toBe(422)
  })

  it('ADD: returns 409 when the address is already in use (instant path)', async () => {
    asAdd()
    mockRequestCredentialEmail.mockResolvedValue({ result: 'email-in-use' })
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'taken@example.com', newPassword: 'pass1234', confirmPassword: 'pass1234' }))
    expect(res.status).toBe(409)
  })

  it('CHANGE: returns 409 when the address is already in use (instant path)', async () => {
    mockRequestCredentialEmail.mockResolvedValue({ result: 'email-in-use' })
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'taken@example.com', password: CURRENT_PW }))
    expect(res.status).toBe(409)
    expect(mockRequestCredentialEmail).toHaveBeenCalledWith('user-1', 'taken@example.com', undefined)
  })

  it('returns 422 when the new passwords do not match (parse fails before re-auth)', async () => {
    asAdd()
    const res = await REQUEST_CREDENTIAL_EMAIL(req('POST', { email: 'new@example.com', newPassword: 'pass1234', confirmPassword: 'nope5678' }))
    expect(res.status).toBe(422)
    expect(mockRequestCredentialEmail).not.toHaveBeenCalled()
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
      user: {
        email: 'me@example.com',
        credentialEmail: null,
        credentialEmailVerified: null,
        hasPassword: false,
        accounts: [{ id: 'acc-1', provider: 'google', email: OWNED_EMAIL }],
      },
    })
    const res = await UPDATE_MAIN_EMAIL(req('PATCH', { email: OWNED_EMAIL }))
    expect(res.status).toBe(204)
    expect(mockUpdateEmail).toHaveBeenCalledWith('user-1', OWNED_EMAIL)
  })

  it('returns 409 when another user holds the address', async () => {
    mockIsEmailTaken.mockResolvedValue(true)
    const res = await UPDATE_MAIN_EMAIL(req('PATCH', { email: OWNED_EMAIL, password: 'password123' }))
    expect(res.status).toBe(409)
    expect(mockUpdateEmail).not.toHaveBeenCalled()
  })

  it('returns 409 when a concurrent write hits the primary-email unique constraint', async () => {
    mockUpdateEmail.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )
    const res = await UPDATE_MAIN_EMAIL(req('PATCH', { email: OWNED_EMAIL, password: 'password123' }))
    expect(res.status).toBe(409)
    expect(mockSyncStripeEmail).not.toHaveBeenCalled()
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

  it('returns 204, unlinks scoped to the session userId, and notifies the owner', async () => {
    const res = await UNLINK_ACCOUNT(req('DELETE'), params('acc-1'))
    expect(res.status).toBe(204)
    expect(mockUnlink).toHaveBeenCalledWith('user-1', 'acc-1')
    expect(mockNotify).toHaveBeenCalledWith('user-1', 'method-unlinked')
  })
})

describe('GET /profile', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET_PROFILE(req('GET'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when profile context is missing', async () => {
    mockGetProfile.mockResolvedValue(null)
    const res = await GET_PROFILE(req('GET'))
    expect(res.status).toBe(404)
  })

  it('returns 200 with the profile context on success', async () => {
    const res = await GET_PROFILE(req('GET'))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.email).toBe('me@example.com')
  })
})

describe('GET /profile/me', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET_PROFILE_ME(req('GET'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with profile flags', async () => {
    const res = await GET_PROFILE_ME(req('GET'))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.name).toBe('me')
    expect(body.email).toBe('me@example.com')
    expect(body.image).toBe('img')
    expect(body.isPro).toBe(false)
    expect(body.canCreateItem).toBe(true)
    expect(body.canCreateCollection).toBe(true)
  })
})

describe('GET /profile/editor-preferences', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await GET_EDITOR_PREFS(req('GET'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with normalized editor preferences', async () => {
    const res = await GET_EDITOR_PREFS(req('GET'))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.appTheme).toBeDefined()
  })
})
