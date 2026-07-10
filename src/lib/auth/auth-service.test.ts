import { vi, describe, it, expect, beforeEach } from 'vitest'
import { anyOf } from '@/test/matchers'
import bcrypt from 'bcryptjs'
import { Prisma } from '@/generated/prisma'
import type { restoreCredentialEmailToken } from '@/lib/auth/tokens'
import type { ChangeCredentialEmailResult } from '@/lib/db/users'

// Mock dependencies
vi.mock('bcryptjs', () => ({
  default: {
    // `bcrypt.hash`/`compare` are overloaded (Promise-returning vs. callback-returning `void`); a bare
    // `typeof bcrypt.hash` resolves to the last (callback) overload, so the Promise-returning signature
    // actually used here is spelled out explicitly instead.
    hash: vi.fn<(password: string, salt: number | string) => Promise<string>>(),
    compare: vi.fn<(password: string, hash: string) => Promise<boolean>>(),
  },
}))

vi.mock('@/lib/db/users', () => ({
  getUserAuthInfoByEmail: vi.fn<typeof getUserAuthInfoByEmail>(),
  getUserAuthMethods: vi.fn<typeof getUserAuthMethods>(),
  createCredentialUser: vi.fn<typeof createCredentialUser>(),
  updateUserPassword: vi.fn<typeof updateUserPassword>(),
  setPasswordAndVerifyEmail: vi.fn<typeof setPasswordAndVerifyEmail>(),
  bootstrapCredentialLogin: vi.fn<typeof bootstrapCredentialLogin>(),
  findUserByAnyEmail: vi.fn<typeof findUserByAnyEmail>(),
  setCredentialEmailLogin: vi.fn<typeof setCredentialEmailLogin>(),
  changeCredentialEmail: vi.fn<typeof changeCredentialEmail>(),
  isEmailTakenByAnotherUser: vi.fn<typeof isEmailTakenByAnotherUser>(),
  checkProviderAccountExists: vi.fn<typeof checkProviderAccountExists>(),
  createAccount: vi.fn<typeof createAccount>(),
}))

vi.mock('@/lib/infra/cache', () => ({
  invalidateProfileCache: vi.fn<typeof invalidateProfileCache>(),
}))

vi.mock('@/lib/billing/lifecycle/stripe-billing-lifecycle', () => ({
  // auth-service uses the resilient variant — its own swallow-and-log is unit-tested in the billing
  // module, so here it is a plain vi.fn (resolves) and never simulates a throw.
  syncStripeCustomerEmailForUserSafe: vi.fn<typeof syncStripeCustomerEmailForUserSafe>(),
}))

vi.mock('@/lib/utils/auth', () => ({
  outboundEmailEnabled: vi.fn<typeof outboundEmailEnabled>(),
}))

vi.mock('@/lib/emails/verification', () => ({
  sendRegistrationVerification: vi.fn<typeof sendRegistrationVerification>(),
  resendVerification: vi.fn<typeof resendVerification>(),
}))

vi.mock('@/lib/emails/password-reset', () => ({
  sendPasswordResetRequest: vi.fn<typeof sendPasswordResetRequest>(),
}))

vi.mock('@/lib/emails/credential-email', () => ({
  sendCredentialEmailLink: vi.fn<typeof sendCredentialEmailLink>(),
}))

vi.mock('@/lib/emails/security-notification', () => ({
  sendSecurityNotification: vi.fn<typeof sendSecurityNotification>(),
}))

vi.mock('@/lib/auth/tokens', () => ({
  consumePasswordResetToken: vi.fn<typeof consumePasswordResetToken>(),
  consumeCredentialEmailToken: vi.fn<typeof consumeCredentialEmailToken>(),
  peekCredentialEmailPayload: vi.fn<typeof peekCredentialEmailPayload>(),
  createCredentialEmailToken: vi.fn<typeof createCredentialEmailToken>(),
  deleteCredentialEmailToken: vi.fn<typeof deleteCredentialEmailToken>(),
  restoreCredentialEmailToken: vi.fn<typeof restoreCredentialEmailToken>(),
}))

vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn<typeof checkRateLimit>(),
}))

import {
  validateUserPassword,
  verifyUserPasswordById,
  changeUserPassword,
  registerUser,
  triggerPasswordReset,
  applyPasswordReset,
  requestCredentialEmail,
  confirmCredentialEmail,
  assertCredentialLoginAllowed,
  linkPendingAccount,
} from './auth-service'

import {
  getUserAuthInfoByEmail,
  getUserAuthMethods,
  createCredentialUser,
  updateUserPassword,
  setPasswordAndVerifyEmail,
  bootstrapCredentialLogin,
  findUserByAnyEmail,
  setCredentialEmailLogin,
  changeCredentialEmail,
  isEmailTakenByAnotherUser,
  checkProviderAccountExists,
  createAccount,
} from '@/lib/db/users'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { syncStripeCustomerEmailForUserSafe } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { outboundEmailEnabled } from '@/lib/utils/auth'
import { sendRegistrationVerification, resendVerification } from '@/lib/emails/verification'
import { sendPasswordResetRequest } from '@/lib/emails/password-reset'
import { sendCredentialEmailLink } from '@/lib/emails/credential-email'
import { sendSecurityNotification } from '@/lib/emails/security-notification'
import {
  consumePasswordResetToken,
  consumeCredentialEmailToken,
  peekCredentialEmailPayload,
  createCredentialEmailToken,
  deleteCredentialEmailToken,
} from '@/lib/auth/tokens'
import { checkRateLimit } from '@/lib/infra/rate-limit'

// `bcrypt.hash`/`compare` are overloaded (Promise-returning vs. callback-returning `void`) on the real
// module; pin `vi.mocked` to the Promise-returning overload actually used here (a bare `typeof
// bcrypt.hash` would resolve to the last, callback, overload).
const mockBcryptHash = vi.mocked<(password: string, salt: number | string) => Promise<string>>(bcrypt.hash)
const mockBcryptCompare = vi.mocked<(password: string, hash: string) => Promise<boolean>>(bcrypt.compare)

const mockGetUserAuthInfoByEmail = vi.mocked(getUserAuthInfoByEmail)
const mockGetUserAuthMethods = vi.mocked(getUserAuthMethods)
const mockCreateCredentialUser = vi.mocked(createCredentialUser)
const mockUpdateUserPassword = vi.mocked(updateUserPassword)
const mockSetPasswordAndVerifyEmail = vi.mocked(setPasswordAndVerifyEmail)
const mockBootstrapCredentialLogin = vi.mocked(bootstrapCredentialLogin)
const mockFindUserByAnyEmail = vi.mocked(findUserByAnyEmail)

const mockInvalidateProfileCache = vi.mocked(invalidateProfileCache)
const mockSyncStripeCustomerEmail = vi.mocked(syncStripeCustomerEmailForUserSafe)

const mockEmailVerificationEnabled = vi.mocked(outboundEmailEnabled)
const mockSendRegistrationVerification = vi.mocked(sendRegistrationVerification)
const mockResendVerification = vi.mocked(resendVerification)
const mockSendPasswordResetRequest = vi.mocked(sendPasswordResetRequest)
const mockSendSecurityNotification = vi.mocked(sendSecurityNotification)
const mockConsumePasswordResetToken = vi.mocked(consumePasswordResetToken)
const mockConsumeCredentialEmailToken = vi.mocked(consumeCredentialEmailToken)
const mockPeekCredentialEmailPayload = vi.mocked(peekCredentialEmailPayload)
const mockCreateCredentialEmailToken = vi.mocked(createCredentialEmailToken)
const mockDeleteCredentialEmailToken = vi.mocked(deleteCredentialEmailToken)
const mockSetCredentialEmailLogin = vi.mocked(setCredentialEmailLogin)
const mockChangeCredentialEmail = vi.mocked(changeCredentialEmail)
const mockIsEmailTakenByAnotherUser = vi.mocked(isEmailTakenByAnotherUser)
const mockSendCredentialEmailLink = vi.mocked(sendCredentialEmailLink)
const mockCheckRateLimit = vi.mocked(checkRateLimit)
const mockCheckProviderAccountExists = vi.mocked(checkProviderAccountExists)
const mockCreateAccount = vi.mocked(createAccount)

// Full-shape fixture helpers — the real db/token exports carry the field set filled in below, but
// each test only ever varies a couple of fields. These keep mockResolvedValue satisfying the now
// precisely-typed mocks (see vi.fn<typeof realExport>() above) without repeating unrelated fields at
// every call site.
type AuthInfoUser = NonNullable<Awaited<ReturnType<typeof getUserAuthInfoByEmail>>>
function authInfoUser(overrides: Partial<AuthInfoUser> = {}): AuthInfoUser {
  return {
    id: '1',
    email: 'test@example.com',
    name: null,
    image: null,
    password: null,
    emailVerified: null,
    credentialEmail: null,
    credentialEmailVerified: null,
    matchedField: 'email',
    matchedVerified: null,
    ...overrides,
  }
}

type AuthMethodsUser = NonNullable<Awaited<ReturnType<typeof getUserAuthMethods>>>
function authMethodsUser(overrides: Partial<AuthMethodsUser> = {}): AuthMethodsUser {
  return {
    email: 'test@example.com',
    credentialEmail: null,
    password: null,
    accounts: [],
    ...overrides,
  }
}

type TestCredentialEmailPayload = NonNullable<Awaited<ReturnType<typeof peekCredentialEmailPayload>>>
function credentialEmailPayload(
  overrides: Partial<TestCredentialEmailPayload> & Pick<TestCredentialEmailPayload, 'userId' | 'email'>,
): TestCredentialEmailPayload {
  return { mode: 'add', gen: 1, ...overrides }
}

function changeCredentialResult(
  overrides: Partial<ChangeCredentialEmailResult> & Pick<ChangeCredentialEmailResult, 'status' | 'emailMoved'>,
): ChangeCredentialEmailResult {
  return { previousLoginEmail: null, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
})

describe('auth-service', () => {
  describe('assertCredentialLoginAllowed', () => {
    it('rejects oversized passwords without calling rate limit', async () => {
      const result = await assertCredentialLoginAllowed('127.0.0.1', 'a'.repeat(129))
      expect(result).toEqual({ ok: false, reason: 'password-too-long', retryAfter: 0 })
      expect(mockCheckRateLimit).not.toHaveBeenCalled()
    })

    it('rejects when the IP guard denies', async () => {
      mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 42 })
      const result = await assertCredentialLoginAllowed('127.0.0.1', 'secret')
      expect(result).toEqual({ ok: false, reason: 'ip-rate-limited', retryAfter: 42 })
      expect(mockCheckRateLimit).toHaveBeenCalledWith('loginIP', '127.0.0.1')
    })

    it('allows when password length and IP guard pass', async () => {
      expect(await assertCredentialLoginAllowed('127.0.0.1', 'secret')).toEqual({ ok: true })
    })
  })

  describe('validateUserPassword', () => {
    it('returns null without bcrypt when password exceeds max length', async () => {
      expect(await validateUserPassword('test@example.com', 'a'.repeat(129))).toBeNull()
      expect(mockGetUserAuthInfoByEmail).not.toHaveBeenCalled()
      expect(mockBcryptCompare).not.toHaveBeenCalled()
    })

    it('returns null and runs a dummy compare when the user is absent', async () => {
      mockGetUserAuthInfoByEmail.mockResolvedValue(null)
      expect(await validateUserPassword('test@example.com', 'pass')).toBeNull()
      expect(mockBcryptCompare).toHaveBeenCalledTimes(1) // dummy compare ran
    })

    it('returns null and runs a dummy compare for an OAuth-only account (no password)', async () => {
      mockGetUserAuthInfoByEmail.mockResolvedValue(authInfoUser({ password: null }))
      expect(await validateUserPassword('test@example.com', 'pass')).toBeNull()
      expect(mockBcryptCompare).toHaveBeenCalledTimes(1) // dummy compare ran
    })

    it('returns null if password comparison fails', async () => {
      mockGetUserAuthInfoByEmail.mockResolvedValue(authInfoUser({ password: 'hashed' }))
      mockBcryptCompare.mockResolvedValue(false)
      expect(await validateUserPassword('test@example.com', 'wrong')).toBeNull()
    })

    it('returns user if password matches', async () => {
      const user = authInfoUser({ id: '1', password: 'hashed' })
      mockGetUserAuthInfoByEmail.mockResolvedValue(user)
      mockBcryptCompare.mockResolvedValue(true)
      expect(await validateUserPassword('test@example.com', 'pass')).toEqual(user)
    })
  })

  describe('verifyUserPasswordById', () => {
    it('returns false if user not found or no password', async () => {
      mockGetUserAuthMethods.mockResolvedValue(null)
      expect(await verifyUserPasswordById('1', 'pass')).toBe(false)
    })

    it('returns comparison result', async () => {
      mockGetUserAuthMethods.mockResolvedValue(authMethodsUser({ password: 'hashed' }))
      mockBcryptCompare.mockResolvedValue(true)
      expect(await verifyUserPasswordById('1', 'pass')).toBe(true)
    })
  })

  describe('changeUserPassword', () => {
    it('hashes password, updates db, invalidates cache, and notifies', async () => {
      mockBcryptHash.mockResolvedValue('new-hashed')
      await changeUserPassword('1', 'new-pass')

      expect(mockBcryptHash).toHaveBeenCalledWith('new-pass', 12) // BCRYPT_ROUNDS = 12
      expect(mockUpdateUserPassword).toHaveBeenCalledWith('1', 'new-hashed')
      expect(mockInvalidateProfileCache).toHaveBeenCalledWith('1')
      expect(mockSendSecurityNotification).toHaveBeenCalledWith('1', 'password-changed')
    })
  })

  describe('registerUser', () => {
    it('mirrors success without sending when the existing email is verified with a password', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'test@example.com', password: 'hash', emailVerified: new Date() })

      const result = await registerUser('Test', 'test@example.com', 'pass')
      expect(result.result).toBe('sent') // Silently mirrors success — no enumeration leak
      expect(result.sendEmail).toBeUndefined()
      expect(mockCreateCredentialUser).not.toHaveBeenCalled()
      expect(mockResendVerification).not.toHaveBeenCalled()
      expect(mockSendPasswordResetRequest).not.toHaveBeenCalled()
    })

    it('resends verification when the existing account has a password but is unverified', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'test@example.com', password: 'hash', emailVerified: null })

      const result = await registerUser('Test', 'test@example.com', 'pass')
      expect(result.result).toBe('sent')
      expect(result.sendEmail).toBeDefined()
      if (result.sendEmail) await result.sendEmail()
      expect(mockCreateCredentialUser).not.toHaveBeenCalled()
      expect(mockResendVerification).toHaveBeenCalledWith('test@example.com')
      expect(mockSendPasswordResetRequest).not.toHaveBeenCalled()
    })

    it('sends the set-password email for an existing OAuth-only account matched by primary', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'test@example.com', password: null, emailVerified: null })

      const result = await registerUser('Test', 'test@example.com', 'pass')
      expect(result.result).toBe('sent')
      expect(result.sendEmail).toBeDefined()
      if (result.sendEmail) await result.sendEmail()
      expect(mockCreateCredentialUser).not.toHaveBeenCalled()
      expect(mockSendPasswordResetRequest).toHaveBeenCalledWith('test@example.com')
      expect(mockResendVerification).not.toHaveBeenCalled()
    })

    it('rejects with email-in-use (no link sent) for an OAuth-only account when verification is disabled', async () => {
      mockEmailVerificationEnabled.mockReturnValue(false)
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'foo@example.com', password: null, emailVerified: null })

      const result = await registerUser('Test', 'foo@example.com', 'pass')
      // Dev mode has no verification link to prove ownership → can't merge safely; report it as in use.
      expect(result.result).toBe('email-in-use')
      expect(mockSendPasswordResetRequest).not.toHaveBeenCalled()
      expect(mockCreateCredentialUser).not.toHaveBeenCalled()
    })

    it('rejects with email-in-use for an existing Email & Password account when verification is disabled', async () => {
      mockEmailVerificationEnabled.mockReturnValue(false)
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'bar@example.com', password: 'hash', emailVerified: new Date() })

      const result = await registerUser('Test', 'bar@example.com', 'pass')
      // Same dev-mode rule for ANY existing account — no silent 'skipped'/redirect with a discarded password.
      expect(result.result).toBe('email-in-use')
      expect(mockCreateCredentialUser).not.toHaveBeenCalled()
    })

    it('sends the set-password email to the PRIMARY when matched by a secondary email', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'primary@example.com', password: null, emailVerified: null })

      const result = await registerUser('Test', 'secondary@example.com', 'pass')
      expect(result.result).toBe('sent')
      expect(result.sendEmail).toBeDefined()
      if (result.sendEmail) await result.sendEmail()
      expect(mockCreateCredentialUser).not.toHaveBeenCalled()
      expect(mockSendPasswordResetRequest).toHaveBeenCalledWith('primary@example.com')
    })

    it('creates user and sends verification if enabled', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockFindUserByAnyEmail.mockResolvedValue(null)
      mockCreateCredentialUser.mockResolvedValue('ok')
      mockBcryptHash.mockResolvedValue('hashed')
      mockSendRegistrationVerification.mockResolvedValue('sent')

      const result = await registerUser('Test', 'test@example.com', 'pass')

      expect(mockCreateCredentialUser).toHaveBeenCalledWith({
        name: 'Test',
        email: 'test@example.com',
        password: 'hashed',
        emailVerified: undefined,
        // Registration writes the credential-login email and mirrors it into the primary email,
        // verified in lockstep (both pending here, since verification is enabled).
        credentialEmail: 'test@example.com',
        credentialEmailVerified: undefined,
      })
      expect(result.result).toBe('sent')
      expect(result.sendEmail).toBeDefined()
      if (result.sendEmail) await result.sendEmail()
      expect(mockSendRegistrationVerification).toHaveBeenCalledWith('test@example.com')
    })

    it('creates user and skips verification if disabled', async () => {
      mockEmailVerificationEnabled.mockReturnValue(false)
      mockFindUserByAnyEmail.mockResolvedValue(null)
      mockCreateCredentialUser.mockResolvedValue('ok')
      mockBcryptHash.mockResolvedValue('hashed')

      const result = await registerUser('Test', 'test@example.com', 'pass')

      expect(mockCreateCredentialUser).toHaveBeenCalledWith(expect.objectContaining({
        emailVerified: anyOf(Date),
        // Verification disabled → credential email mirrored and verified at the same instant.
        credentialEmail: 'test@example.com',
        credentialEmailVerified: anyOf(Date),
      }))
      expect(result.result).toBe('skipped')
    })

    it('falls through to the enumeration-safe path when create loses a race (A-1)', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      // First resolve: no existing account. After create reports a collision, re-resolve finds the
      // account that won the race (a verified Email & Password user) → mirror 'sent', no duplicate.
      mockFindUserByAnyEmail
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: '1', email: 'race@example.com', password: 'hash', emailVerified: new Date() })
      mockCreateCredentialUser.mockResolvedValue('in-use')
      mockBcryptHash.mockResolvedValue('hashed')

      const result = await registerUser('Test', 'race@example.com', 'pass')
      expect(result.result).toBe('sent')
      expect(mockSendRegistrationVerification).not.toHaveBeenCalled()
      expect(mockResendVerification).not.toHaveBeenCalled()
    })
  })

  describe('triggerPasswordReset', () => {
    it('does not send email if no account is found', async () => {
      mockFindUserByAnyEmail.mockResolvedValue(null)
      await triggerPasswordReset('test@example.com')
      expect(mockSendPasswordResetRequest).not.toHaveBeenCalled()
    })

    it('sends to the primary email for an OAuth-only account without a password', async () => {
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'test@example.com', password: null, emailVerified: null })
      await triggerPasswordReset('test@example.com')
      expect(mockSendPasswordResetRequest).toHaveBeenCalledWith('test@example.com')
    })

    it('resolves via a secondary email but sends to the primary', async () => {
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'primary@example.com', password: 'hash', emailVerified: new Date() })
      await triggerPasswordReset('secondary@example.com')
      expect(mockSendPasswordResetRequest).toHaveBeenCalledWith('primary@example.com')
    })
  })

  describe('applyPasswordReset', () => {
    it('returns invalid-token if token not found', async () => {
      mockConsumePasswordResetToken.mockResolvedValue(null)
      expect(await applyPasswordReset('token', 'pass')).toBe('invalid-token')
    })

    it('returns invalid-token if the resolved user no longer exists', async () => {
      mockConsumePasswordResetToken.mockResolvedValue({ email: 'test@example.com' })
      mockGetUserAuthInfoByEmail.mockResolvedValue(null)
      expect(await applyPasswordReset('token', 'pass')).toBe('invalid-token')
    })

    it('bootstraps the credential login (password + verified email == credentialEmail) for an OAuth-only account and notifies credential-email-added', async () => {
      mockConsumePasswordResetToken.mockResolvedValue({ email: 'test@example.com' })
      mockGetUserAuthInfoByEmail.mockResolvedValue(authInfoUser({ id: '1', email: 'test@example.com', password: null, emailVerified: null }))
      mockBcryptHash.mockResolvedValue('new-hashed')

      const result = await applyPasswordReset('token', 'new-pass')

      // Bootstrap writes credentialEmail = the proven primary email, merging E&P into the account.
      expect(mockBootstrapCredentialLogin).toHaveBeenCalledWith('1', 'new-hashed', 'test@example.com')
      expect(mockSetPasswordAndVerifyEmail).not.toHaveBeenCalled()
      expect(mockUpdateUserPassword).not.toHaveBeenCalled()
      // First credential login added → clearer "sign-in email added" copy, not generic "password set". (item 4)
      expect(mockSendSecurityNotification).toHaveBeenCalledWith('1', 'credential-email-added')
      expect(result).toBe('ok')
    })

    it('sets emailVerified for an unverified credentials account (pre-existing-gap fix)', async () => {
      mockConsumePasswordResetToken.mockResolvedValue({ email: 'test@example.com' })
      mockGetUserAuthInfoByEmail.mockResolvedValue(authInfoUser({ id: '1', password: 'old', emailVerified: null }))
      mockBcryptHash.mockResolvedValue('new-hashed')

      const result = await applyPasswordReset('token', 'new-pass')

      expect(mockSetPasswordAndVerifyEmail).toHaveBeenCalledWith('1', 'new-hashed')
      expect(mockSendSecurityNotification).toHaveBeenCalledWith('1', 'password-reset')
      expect(result).toBe('ok')
    })

    it('updates password but leaves emailVerified untouched for a verified account', async () => {
      mockConsumePasswordResetToken.mockResolvedValue({ email: 'test@example.com' })
      mockGetUserAuthInfoByEmail.mockResolvedValue(authInfoUser({ id: '1', password: 'old', emailVerified: new Date() }))
      mockBcryptHash.mockResolvedValue('new-hashed')

      const result = await applyPasswordReset('token', 'new-pass')

      expect(mockUpdateUserPassword).toHaveBeenCalledWith('1', 'new-hashed')
      expect(mockSetPasswordAndVerifyEmail).not.toHaveBeenCalled()
      expect(mockInvalidateProfileCache).toHaveBeenCalledWith('1')
      expect(mockSendSecurityNotification).toHaveBeenCalledWith('1', 'password-reset')
      expect(result).toBe('ok')
    })
  })

  describe('requestCredentialEmail', () => {
    // No existing password → this is a first-time ADD.
    const asAdd = () => mockGetUserAuthMethods.mockResolvedValue(authMethodsUser({ password: null }))
    // Existing password → this is a CHANGE (re-point of the sign-in email).
    const asChange = () => mockGetUserAuthMethods.mockResolvedValue(authMethodsUser({ password: 'existing-hash' }))

    describe('with email verification enabled (confirmation link)', () => {
      beforeEach(() => {
        mockEmailVerificationEnabled.mockReturnValue(true)
        mockCreateCredentialEmailToken.mockResolvedValue('issued-token')
        mockSendCredentialEmailLink.mockResolvedValue(true)
      })

      it('does not send when the address is already used as any email, credentialEmail, or linked OAuth email', async () => {
        asAdd()
        mockIsEmailTakenByAnotherUser.mockResolvedValue(true)
        const result = await requestCredentialEmail('user-1', 'taken@example.com')
        expect(result.result).toBe('sent')
        expect(result.sendEmail).toBeUndefined()
        expect(mockCreateCredentialEmailToken).not.toHaveBeenCalled()
        expect(mockSendCredentialEmailLink).not.toHaveBeenCalled()
      })

      it('emails an ADD confirmation link when the user has no password yet', async () => {
        asAdd()
        mockIsEmailTakenByAnotherUser.mockResolvedValue(false)
        const result = await requestCredentialEmail('user-1', 'new@example.com')
        expect(result.result).toBe('sent')
        expect(result.sendEmail).toBeDefined()
        if (result.sendEmail) await result.sendEmail()
        expect(mockCreateCredentialEmailToken).toHaveBeenCalledWith('user-1', 'new@example.com', 'add')
        expect(mockSendCredentialEmailLink).toHaveBeenCalledWith('new@example.com', 'issued-token', 'add')
      })

      it('emails a CHANGE confirmation link when the user already has a password', async () => {
        asChange()
        mockIsEmailTakenByAnotherUser.mockResolvedValue(false)
        const result = await requestCredentialEmail('user-1', 'new@example.com')
        expect(result.result).toBe('sent')
        expect(result.sendEmail).toBeDefined()
        if (result.sendEmail) await result.sendEmail()
        expect(mockCreateCredentialEmailToken).toHaveBeenCalledWith('user-1', 'new@example.com', 'change')
        expect(mockSendCredentialEmailLink).toHaveBeenCalledWith('new@example.com', 'issued-token', 'change')
      })

      it('still sends when the address is owned by the caller (not taken by another user)', async () => {
        asChange()
        mockIsEmailTakenByAnotherUser.mockResolvedValue(false)
        const result = await requestCredentialEmail('user-1', 'linked@oauth.com')
        expect(result.result).toBe('sent')
        expect(result.sendEmail).toBeDefined()
        if (result.sendEmail) await result.sendEmail()
        expect(mockIsEmailTakenByAnotherUser).toHaveBeenCalledWith('user-1', 'linked@oauth.com')
        expect(mockCreateCredentialEmailToken).toHaveBeenCalledWith('user-1', 'linked@oauth.com', 'change')
        expect(mockSendCredentialEmailLink).toHaveBeenCalledWith('linked@oauth.com', 'issued-token', 'change')
      })

      it('returns send-failed when token creation fails', async () => {
        asAdd()
        mockIsEmailTakenByAnotherUser.mockResolvedValue(false)
        mockCreateCredentialEmailToken.mockRejectedValue(new Error('Redis unavailable'))
        const result = await requestCredentialEmail('user-1', 'new@example.com')
        expect(result.result).toBe('sent')
        expect(result.sendEmail).toBeDefined()
        if (result.sendEmail) await result.sendEmail()
        expect(mockSendCredentialEmailLink).not.toHaveBeenCalled()
      })

      it('returns send-failed when Resend rejects the confirmation email', async () => {
        asAdd()
        mockIsEmailTakenByAnotherUser.mockResolvedValue(false)
        mockSendCredentialEmailLink.mockResolvedValue(false)
        const result = await requestCredentialEmail('user-1', 'new@example.com')
        expect(result.result).toBe('sent')
        expect(result.sendEmail).toBeDefined()
        if (result.sendEmail) await result.sendEmail()
        expect(mockCreateCredentialEmailToken).toHaveBeenCalledWith('user-1', 'new@example.com', 'add')
        expect(mockDeleteCredentialEmailToken).toHaveBeenCalledWith('issued-token')
      })

      it('returns send-failed when the confirmation send throws unexpectedly', async () => {
        asAdd()
        mockIsEmailTakenByAnotherUser.mockResolvedValue(false)
        mockSendCredentialEmailLink.mockRejectedValue(new Error('Resend unavailable'))
        const result = await requestCredentialEmail('user-1', 'new@example.com')
        expect(result.result).toBe('sent')
        expect(result.sendEmail).toBeDefined()
        if (result.sendEmail) await result.sendEmail()
        expect(mockCreateCredentialEmailToken).toHaveBeenCalledWith('user-1', 'new@example.com', 'add')
        expect(mockDeleteCredentialEmailToken).toHaveBeenCalledWith('issued-token')
      })

      it('does not send when the address is another user\'s linked OAuth email only', async () => {
        asChange()
        mockIsEmailTakenByAnotherUser.mockResolvedValue(true)
        const result = await requestCredentialEmail('user-1', 'victim@gmail.com')
        expect(result.result).toBe('sent')
        expect(result.sendEmail).toBeUndefined()
        expect(mockCreateCredentialEmailToken).not.toHaveBeenCalled()
        expect(mockSendCredentialEmailLink).not.toHaveBeenCalled()
      })
    })

    describe('with email verification disabled (instant activation)', () => {
      beforeEach(() => mockEmailVerificationEnabled.mockReturnValue(false))

      it('returns password-required and writes nothing when an ADD has no password', async () => {
        asAdd()
        const result = await requestCredentialEmail('user-1', 'new@example.com')
        expect(result.result).toBe('password-required')
        expect(mockSetCredentialEmailLogin).not.toHaveBeenCalled()
        expect(mockCreateCredentialEmailToken).not.toHaveBeenCalled()
        expect(mockSendCredentialEmailLink).not.toHaveBeenCalled()
      })

      it('activates the credential login instantly with the password and notifies the owner', async () => {
        asAdd()
        mockBcryptHash.mockResolvedValue('hashed-pw')
        mockSetCredentialEmailLogin.mockResolvedValue('ok')
        const result = await requestCredentialEmail('user-1', 'new@example.com', 'pass1234')
        expect(result.result).toBe('activated')
        expect(mockSetCredentialEmailLogin).toHaveBeenCalledWith('user-1', 'hashed-pw', 'new@example.com')
        expect(mockInvalidateProfileCache).toHaveBeenCalledWith('user-1')
        expect(mockSendSecurityNotification).toHaveBeenCalledWith('user-1', 'credential-email-added')
      })

      it('maps an ADD unique-constraint collision to email-in-use and does not notify', async () => {
        asAdd()
        mockBcryptHash.mockResolvedValue('hashed-pw')
        mockSetCredentialEmailLogin.mockResolvedValue('in-use')
        const result = await requestCredentialEmail('user-1', 'taken@example.com', 'pass1234')
        expect(result.result).toBe('email-in-use')
        expect(mockSendSecurityNotification).not.toHaveBeenCalled()
      })

      it('re-points the email instantly without a password when the user already has one (CHANGE)', async () => {
        asChange()
        mockChangeCredentialEmail.mockResolvedValue({ status: 'ok', emailMoved: false, previousLoginEmail: 'old@example.com' })
        const result = await requestCredentialEmail('user-1', 'new@example.com')
        expect(result.result).toBe('activated')
        expect(mockChangeCredentialEmail).toHaveBeenCalledWith('user-1', 'new@example.com')
        // A change never sets a password, so no hashing happens.
        expect(mockBcryptHash).not.toHaveBeenCalled()
        expect(mockSetCredentialEmailLogin).not.toHaveBeenCalled()
        expect(mockInvalidateProfileCache).toHaveBeenCalledWith('user-1')
        // Alert goes to the OLD sign-in address, never the moved-to primary.
        expect(mockSendSecurityNotification).toHaveBeenCalledWith('user-1', 'credential-email-changed', { to: 'old@example.com' })
        // Primary email didn't move (diverged account) → no Stripe re-sync.
        expect(mockSyncStripeCustomerEmail).not.toHaveBeenCalled()
      })

      it('re-syncs the Stripe customer email when the change moved the primary email', async () => {
        asChange()
        mockChangeCredentialEmail.mockResolvedValue(changeCredentialResult({ status: 'ok', emailMoved: true }))
        const result = await requestCredentialEmail('user-1', 'new@example.com')
        expect(result.result).toBe('activated')
        expect(mockSyncStripeCustomerEmail).toHaveBeenCalledWith('user-1', 'new@example.com')
      })

      it('alerts the OLD sign-in address on an in-sync change, never the moved-to primary', async () => {
        asChange()
        mockChangeCredentialEmail.mockResolvedValue(
          changeCredentialResult({ status: 'ok', emailMoved: true, previousLoginEmail: 'old@example.com' }),
        )
        const result = await requestCredentialEmail('user-1', 'new@example.com')
        expect(result.result).toBe('activated')
        expect(mockSyncStripeCustomerEmail).toHaveBeenCalledWith('user-1', 'new@example.com')
        expect(mockSendSecurityNotification).toHaveBeenCalledWith('user-1', 'credential-email-changed', { to: 'old@example.com' })
      })

      it('maps a CHANGE collision to email-in-use and does not notify', async () => {
        asChange()
        mockChangeCredentialEmail.mockResolvedValue(changeCredentialResult({ status: 'in-use', emailMoved: false }))
        const result = await requestCredentialEmail('user-1', 'taken@example.com')
        expect(result.result).toBe('email-in-use')
        expect(mockSendSecurityNotification).not.toHaveBeenCalled()
      })
    })
  })

  describe('confirmCredentialEmail', () => {
    it('returns invalid-token when the token is absent/expired/used', async () => {
      mockPeekCredentialEmailPayload.mockResolvedValue(null)
      expect(await confirmCredentialEmail('token', 'pass')).toBe('invalid-token')
      expect(mockConsumeCredentialEmailToken).not.toHaveBeenCalled()
      expect(mockSetCredentialEmailLogin).not.toHaveBeenCalled()
    })

    describe('add mode', () => {
      // Confirm derives the operation from current state: no password yet → add path. (item 3)
      beforeEach(() => mockGetUserAuthMethods.mockResolvedValue(authMethodsUser({ password: null })))

      it('writes password + credentialEmail and notifies the owner on success', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com', mode: 'add' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockBcryptHash.mockResolvedValue('new-hashed')
        mockSetCredentialEmailLogin.mockResolvedValue('ok')

        const result = await confirmCredentialEmail('token', 'new-pass')

        expect(mockBcryptHash).toHaveBeenCalledWith('new-pass', 12)
        expect(mockSetCredentialEmailLogin).toHaveBeenCalledWith('user-1', 'new-hashed', 'new@example.com')
        expect(mockInvalidateProfileCache).toHaveBeenCalledWith('user-1')
        // Notification goes to the account owner (primary email resolved by userId), never the new address.
        expect(mockSendSecurityNotification).toHaveBeenCalledWith('user-1', 'credential-email-added')
        expect(result).toBe('ok')
      })

      it('returns password-required when an add confirm carries no password', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com', mode: 'add' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        expect(await confirmCredentialEmail('token')).toBe('password-required')
        expect(mockConsumeCredentialEmailToken).toHaveBeenCalledWith('token')
        expect(mockSetCredentialEmailLogin).not.toHaveBeenCalled()
      })

      it('defaults a mode-less (legacy) token to add', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockBcryptHash.mockResolvedValue('new-hashed')
        mockSetCredentialEmailLogin.mockResolvedValue('ok')
        expect(await confirmCredentialEmail('token', 'new-pass')).toBe('ok')
        expect(mockSetCredentialEmailLogin).toHaveBeenCalledWith('user-1', 'new-hashed', 'new@example.com')
      })

      it('maps a unique-constraint collision to email-in-use (409) and does not notify', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'taken@example.com', mode: 'add' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockBcryptHash.mockResolvedValue('new-hashed')
        mockSetCredentialEmailLogin.mockResolvedValue('in-use')

        const result = await confirmCredentialEmail('token', 'new-pass')

        expect(result).toBe('email-in-use')
        expect(mockSendSecurityNotification).not.toHaveBeenCalled()
      })

      it('maps a deleted user (token spent after account removal) to invalid-token and does not notify', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com', mode: 'add' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockBcryptHash.mockResolvedValue('new-hashed')
        mockSetCredentialEmailLogin.mockResolvedValue('not-found')

        const result = await confirmCredentialEmail('token', 'new-pass')

        expect(result).toBe('invalid-token')
        expect(mockInvalidateProfileCache).not.toHaveBeenCalled()
        expect(mockSendSecurityNotification).not.toHaveBeenCalled()
      })
    })

    describe('change mode', () => {
      // Confirm derives the operation from current state: has a password → change/re-point path. (item 3)
      beforeEach(() => mockGetUserAuthMethods.mockResolvedValue(authMethodsUser({ password: 'existing-hash' })))

      it('re-points credentialEmail without touching the password and notifies the owner', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com', mode: 'change' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockChangeCredentialEmail.mockResolvedValue(
          changeCredentialResult({ status: 'ok', emailMoved: false, previousLoginEmail: 'old@example.com' }),
        )

        const result = await confirmCredentialEmail('token')

        expect(mockChangeCredentialEmail).toHaveBeenCalledWith('user-1', 'new@example.com')
        // No password is set on a change.
        expect(mockBcryptHash).not.toHaveBeenCalled()
        expect(mockSetCredentialEmailLogin).not.toHaveBeenCalled()
        expect(mockInvalidateProfileCache).toHaveBeenCalledWith('user-1')
        // Alert goes to the OLD sign-in address, never the moved-to primary.
        expect(mockSendSecurityNotification).toHaveBeenCalledWith('user-1', 'credential-email-changed', { to: 'old@example.com' })
        expect(mockSyncStripeCustomerEmail).not.toHaveBeenCalled() // primary email didn't move
        expect(result).toBe('ok')
      })

      it('re-syncs the Stripe customer email when the confirmed change moved the primary email', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com', mode: 'change' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockChangeCredentialEmail.mockResolvedValue(changeCredentialResult({ status: 'ok', emailMoved: true }))

        const result = await confirmCredentialEmail('token')

        expect(mockSyncStripeCustomerEmail).toHaveBeenCalledWith('user-1', 'new@example.com')
        expect(result).toBe('ok')
      })

      it('alerts the OLD sign-in address on an in-sync confirmed change, never the moved-to primary', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com', mode: 'change' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockChangeCredentialEmail.mockResolvedValue(
          changeCredentialResult({ status: 'ok', emailMoved: true, previousLoginEmail: 'old@example.com' }),
        )

        const result = await confirmCredentialEmail('token')

        expect(result).toBe('ok')
        expect(mockSyncStripeCustomerEmail).toHaveBeenCalledWith('user-1', 'new@example.com')
        expect(mockSendSecurityNotification).toHaveBeenCalledWith('user-1', 'credential-email-changed', { to: 'old@example.com' })
      })

      it('maps a change collision to email-in-use and does not notify', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'taken@example.com', mode: 'change' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockChangeCredentialEmail.mockResolvedValue(changeCredentialResult({ status: 'in-use', emailMoved: false }))

        const result = await confirmCredentialEmail('token')

        expect(result).toBe('email-in-use')
        expect(mockSendSecurityNotification).not.toHaveBeenCalled()
      })

      it('maps a deleted user (token spent after account removal) to invalid-token and does not notify', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com', mode: 'change' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockChangeCredentialEmail.mockResolvedValue(
          changeCredentialResult({ status: 'not-found', emailMoved: false, previousLoginEmail: null }),
        )

        const result = await confirmCredentialEmail('token')

        expect(result).toBe('invalid-token')
        expect(mockInvalidateProfileCache).not.toHaveBeenCalled()
        expect(mockSendSecurityNotification).not.toHaveBeenCalled()
      })
    })

    describe('stale token (state changed between request and confirm)', () => {
      it('re-points instead of clobbering when an ADD token is confirmed after the account gained a password', async () => {
        // Token minted as 'add', but the user now HAS a password → derive 'change': re-point only, keep pw.
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com', mode: 'add' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockGetUserAuthMethods.mockResolvedValue(authMethodsUser({ password: 'existing-hash' }))
        mockChangeCredentialEmail.mockResolvedValue(changeCredentialResult({ status: 'ok', emailMoved: false }))

        const result = await confirmCredentialEmail('token', 'typed-pw')

        expect(mockChangeCredentialEmail).toHaveBeenCalledWith('user-1', 'new@example.com')
        expect(mockSetCredentialEmailLogin).not.toHaveBeenCalled() // existing password never overwritten
        expect(mockBcryptHash).not.toHaveBeenCalled()
        expect(result).toBe('ok')
      })

      it('returns password-required when a CHANGE token is confirmed after the password was removed', async () => {
        // Token minted as 'change' (no password collected), but the user now has NO password → an add is
        // needed and none was provided → 422 without burning the single-use token.
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com', mode: 'change' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockGetUserAuthMethods.mockResolvedValue(authMethodsUser({ password: null }))

        const result = await confirmCredentialEmail('token')

        expect(result).toBe('password-required')
        expect(mockConsumeCredentialEmailToken).toHaveBeenCalled()
        expect(mockChangeCredentialEmail).not.toHaveBeenCalled()
        expect(mockSetCredentialEmailLogin).not.toHaveBeenCalled()
      })

      it('returns invalid-token when the account was deleted after the token was issued', async () => {
        const payload = credentialEmailPayload({ userId: 'user-1', email: 'new@example.com', mode: 'add' })
        mockPeekCredentialEmailPayload.mockResolvedValue(payload)
        mockConsumeCredentialEmailToken.mockResolvedValue(payload)
        mockGetUserAuthMethods.mockResolvedValue(null)

        expect(await confirmCredentialEmail('token', 'pw')).toBe('invalid-token')
        expect(mockConsumeCredentialEmailToken).toHaveBeenCalled()
        expect(mockSetCredentialEmailLogin).not.toHaveBeenCalled()
        expect(mockChangeCredentialEmail).not.toHaveBeenCalled()
      })
    })
  })

  describe('linkPendingAccount', () => {
    const pending = {
      email: 'user@example.com',
      providerEmail: 'oauth@github.com',
      provider: 'github',
      providerAccountId: 'gh-123',
      type: 'oauth',
      access_token: null,
      refresh_token: null,
      expires_at: null,
      token_type: null,
      scope: null,
      id_token: null,
      session_state: null,
    }

    // Full Account row — checkProviderAccountExists resolves to the row or null (not a boolean), and
    // createAccount resolves to the created row; both are typed via vi.fn<typeof realExport>() above.
    const existingAccount = { id: 'account-1' }
    const createdAccount = {
      id: 'account-1',
      userId: 'user-1',
      type: 'oauth',
      provider: 'github',
      providerAccountId: 'gh-123',
      email: 'oauth@github.com',
      refresh_token: null,
      access_token: null,
      expires_at: null,
      token_type: null,
      scope: null,
      id_token: null,
      session_state: null,
    }

    it('creates the account and sends notification when not yet linked', async () => {
      mockCheckProviderAccountExists.mockResolvedValue(null)
      mockCreateAccount.mockResolvedValue(createdAccount)

      await linkPendingAccount('user-1', pending)

      expect(mockCreateAccount).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', provider: 'github' }))
      expect(mockInvalidateProfileCache).toHaveBeenCalledWith('user-1')
      expect(mockSendSecurityNotification).toHaveBeenCalledWith('user-1', 'method-linked')
    })

    it('skips creation and notification when account is already linked', async () => {
      mockCheckProviderAccountExists.mockResolvedValue(existingAccount)

      await linkPendingAccount('user-1', pending)

      expect(mockCreateAccount).not.toHaveBeenCalled()
      expect(mockSendSecurityNotification).not.toHaveBeenCalled()
    })

    it('treats a P2002 race as idempotent success without throwing', async () => {
      mockCheckProviderAccountExists.mockResolvedValue(null)
      mockCreateAccount.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })
      )

      await expect(linkPendingAccount('user-1', pending)).resolves.toBeUndefined()
      expect(mockInvalidateProfileCache).not.toHaveBeenCalled()
    })
  })
})
