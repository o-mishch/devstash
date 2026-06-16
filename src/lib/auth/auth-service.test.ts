import { vi, describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

// Mock dependencies
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
  },
}))

vi.mock('@/lib/db/users', () => ({
  getUserAuthInfoByEmail: vi.fn(),
  getUserAuthMethods: vi.fn(),
  createUser: vi.fn(),
  updateUserPassword: vi.fn(),
  setPasswordAndVerifyEmail: vi.fn(),
  findUserByAnyEmail: vi.fn(),
}))

vi.mock('@/lib/infra/cache', () => ({
  invalidateProfileCache: vi.fn(),
}))

vi.mock('@/lib/emails/verification', () => ({
  emailVerificationEnabled: vi.fn(),
  sendRegistrationVerification: vi.fn(),
  resendVerification: vi.fn(),
}))

vi.mock('@/lib/emails/password-reset', () => ({
  sendPasswordResetRequest: vi.fn(),
}))

vi.mock('@/lib/emails/security-notification', () => ({
  sendSecurityNotification: vi.fn(),
}))

vi.mock('@/lib/auth/tokens', () => ({
  consumePasswordResetToken: vi.fn(),
}))

import {
  validateUserPassword,
  verifyUserPasswordById,
  changeUserPassword,
  setInitialUserPassword,
  registerUser,
  triggerPasswordReset,
  applyPasswordReset,
} from './auth-service'

import {
  getUserAuthInfoByEmail,
  getUserAuthMethods,
  createUser,
  updateUserPassword,
  setPasswordAndVerifyEmail,
  findUserByAnyEmail,
} from '@/lib/db/users'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { emailVerificationEnabled, sendRegistrationVerification, resendVerification } from '@/lib/emails/verification'
import { sendPasswordResetRequest } from '@/lib/emails/password-reset'
import { sendSecurityNotification } from '@/lib/emails/security-notification'
import { consumePasswordResetToken } from '@/lib/auth/tokens'

const mockBcryptHash = bcrypt.hash as unknown as ReturnType<typeof vi.fn>
const mockBcryptCompare = bcrypt.compare as unknown as ReturnType<typeof vi.fn>

const mockGetUserAuthInfoByEmail = getUserAuthInfoByEmail as ReturnType<typeof vi.fn>
const mockGetUserAuthMethods = getUserAuthMethods as ReturnType<typeof vi.fn>
const mockCreateUser = createUser as ReturnType<typeof vi.fn>
const mockUpdateUserPassword = updateUserPassword as ReturnType<typeof vi.fn>
const mockSetPasswordAndVerifyEmail = setPasswordAndVerifyEmail as ReturnType<typeof vi.fn>
const mockFindUserByAnyEmail = findUserByAnyEmail as ReturnType<typeof vi.fn>

const mockInvalidateProfileCache = invalidateProfileCache as ReturnType<typeof vi.fn>

const mockEmailVerificationEnabled = emailVerificationEnabled as ReturnType<typeof vi.fn>
const mockSendRegistrationVerification = sendRegistrationVerification as ReturnType<typeof vi.fn>
const mockResendVerification = resendVerification as ReturnType<typeof vi.fn>
const mockSendPasswordResetRequest = sendPasswordResetRequest as ReturnType<typeof vi.fn>
const mockSendSecurityNotification = sendSecurityNotification as ReturnType<typeof vi.fn>
const mockConsumePasswordResetToken = consumePasswordResetToken as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('auth-service', () => {
  describe('validateUserPassword', () => {
    it('returns null and runs a dummy compare when the user is absent (constant-time, Case 9)', async () => {
      mockGetUserAuthInfoByEmail.mockResolvedValue(null)
      expect(await validateUserPassword('test@example.com', 'pass')).toBeNull()
      expect(mockBcryptCompare).toHaveBeenCalledTimes(1) // dummy compare ran
    })

    it('returns null and runs a dummy compare for an OAuth-only account (no password)', async () => {
      mockGetUserAuthInfoByEmail.mockResolvedValue({ password: null })
      expect(await validateUserPassword('test@example.com', 'pass')).toBeNull()
      expect(mockBcryptCompare).toHaveBeenCalledTimes(1) // dummy compare ran
    })

    it('returns null if password comparison fails', async () => {
      mockGetUserAuthInfoByEmail.mockResolvedValue({ password: 'hashed' })
      mockBcryptCompare.mockResolvedValue(false)
      expect(await validateUserPassword('test@example.com', 'wrong')).toBeNull()
    })

    it('returns user if password matches', async () => {
      const user = { id: '1', password: 'hashed' }
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
      mockGetUserAuthMethods.mockResolvedValue({ password: 'hashed' })
      mockBcryptCompare.mockResolvedValue(true)
      expect(await verifyUserPasswordById('1', 'pass')).toBe(true)
    })
  })

  describe('changeUserPassword', () => {
    it('hashes password, updates db, invalidates cache, and notifies (Case 7)', async () => {
      mockBcryptHash.mockResolvedValue('new-hashed')
      await changeUserPassword('1', 'new-pass')

      expect(mockBcryptHash).toHaveBeenCalledWith('new-pass', 12) // BCRYPT_ROUNDS = 12
      expect(mockUpdateUserPassword).toHaveBeenCalledWith('1', 'new-hashed')
      expect(mockInvalidateProfileCache).toHaveBeenCalledWith('1')
      expect(mockSendSecurityNotification).toHaveBeenCalledWith('1', 'password-changed')
    })
  })

  describe('setInitialUserPassword', () => {
    it('sets password + emailVerified, invalidates cache, and notifies (Case 1 twin, Case 7)', async () => {
      mockBcryptHash.mockResolvedValue('new-hashed')
      await setInitialUserPassword('1', 'new-pass')

      expect(mockBcryptHash).toHaveBeenCalledWith('new-pass', 12)
      expect(mockSetPasswordAndVerifyEmail).toHaveBeenCalledWith('1', 'new-hashed')
      expect(mockUpdateUserPassword).not.toHaveBeenCalled()
      expect(mockInvalidateProfileCache).toHaveBeenCalledWith('1')
      expect(mockSendSecurityNotification).toHaveBeenCalledWith('1', 'password-set')
    })
  })

  describe('registerUser', () => {
    it('mirrors success without sending when the existing email is verified with a password', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'test@example.com', password: 'hash', emailVerified: new Date() })

      const result = await registerUser('Test', 'test@example.com', 'pass')
      expect(result).toBe('sent') // Silently mirrors success — no enumeration leak
      expect(mockCreateUser).not.toHaveBeenCalled()
      expect(mockResendVerification).not.toHaveBeenCalled()
      expect(mockSendPasswordResetRequest).not.toHaveBeenCalled()
    })

    it('resends verification when the existing account has a password but is unverified', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'test@example.com', password: 'hash', emailVerified: null })

      const result = await registerUser('Test', 'test@example.com', 'pass')
      expect(result).toBe('sent')
      expect(mockCreateUser).not.toHaveBeenCalled()
      expect(mockResendVerification).toHaveBeenCalledWith('test@example.com')
      expect(mockSendPasswordResetRequest).not.toHaveBeenCalled()
    })

    it('sends the set-password email for an existing OAuth-only account matched by primary (Case 3)', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'test@example.com', password: null, emailVerified: null })

      const result = await registerUser('Test', 'test@example.com', 'pass')
      expect(result).toBe('sent')
      expect(mockCreateUser).not.toHaveBeenCalled()
      expect(mockSendPasswordResetRequest).toHaveBeenCalledWith('test@example.com')
      expect(mockResendVerification).not.toHaveBeenCalled()
    })

    it('sends the set-password email to the PRIMARY when matched by a secondary email (Case 4)', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'primary@example.com', password: null, emailVerified: null })

      const result = await registerUser('Test', 'secondary@example.com', 'pass')
      expect(result).toBe('sent')
      expect(mockCreateUser).not.toHaveBeenCalled()
      expect(mockSendPasswordResetRequest).toHaveBeenCalledWith('primary@example.com')
    })

    it('creates user and sends verification if enabled', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockFindUserByAnyEmail.mockResolvedValue(null)
      mockBcryptHash.mockResolvedValue('hashed')
      mockSendRegistrationVerification.mockResolvedValue('sent')

      const result = await registerUser('Test', 'test@example.com', 'pass')

      expect(mockCreateUser).toHaveBeenCalledWith({
        name: 'Test',
        email: 'test@example.com',
        password: 'hashed',
        emailVerified: undefined,
      })
      expect(mockSendRegistrationVerification).toHaveBeenCalledWith('test@example.com')
      expect(result).toBe('sent')
    })

    it('creates user and skips verification if disabled', async () => {
      mockEmailVerificationEnabled.mockReturnValue(false)
      mockFindUserByAnyEmail.mockResolvedValue(null)
      mockBcryptHash.mockResolvedValue('hashed')

      const result = await registerUser('Test', 'test@example.com', 'pass')

      expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({
        emailVerified: expect.any(Date)
      }))
      expect(result).toBe('skipped')
    })
  })

  describe('triggerPasswordReset', () => {
    it('does not send email if no account is found', async () => {
      mockFindUserByAnyEmail.mockResolvedValue(null)
      await triggerPasswordReset('test@example.com')
      expect(mockSendPasswordResetRequest).not.toHaveBeenCalled()
    })

    it('sends to the primary email for an OAuth-only account (no password, Case 1)', async () => {
      mockFindUserByAnyEmail.mockResolvedValue({ id: '1', email: 'test@example.com', password: null, emailVerified: null })
      await triggerPasswordReset('test@example.com')
      expect(mockSendPasswordResetRequest).toHaveBeenCalledWith('test@example.com')
    })

    it('resolves via a secondary email but sends to the primary (Case 2)', async () => {
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

    it('sets password + emailVerified for an OAuth-only account and notifies password-set (Case 1)', async () => {
      mockConsumePasswordResetToken.mockResolvedValue({ email: 'test@example.com' })
      mockGetUserAuthInfoByEmail.mockResolvedValue({ id: '1', password: null, emailVerified: null })
      mockBcryptHash.mockResolvedValue('new-hashed')

      const result = await applyPasswordReset('token', 'new-pass')

      expect(mockSetPasswordAndVerifyEmail).toHaveBeenCalledWith('1', 'new-hashed')
      expect(mockUpdateUserPassword).not.toHaveBeenCalled()
      expect(mockSendSecurityNotification).toHaveBeenCalledWith('1', 'password-set')
      expect(result).toBe('ok')
    })

    it('sets emailVerified for an unverified credentials account (pre-existing-gap fix)', async () => {
      mockConsumePasswordResetToken.mockResolvedValue({ email: 'test@example.com' })
      mockGetUserAuthInfoByEmail.mockResolvedValue({ id: '1', password: 'old', emailVerified: null })
      mockBcryptHash.mockResolvedValue('new-hashed')

      const result = await applyPasswordReset('token', 'new-pass')

      expect(mockSetPasswordAndVerifyEmail).toHaveBeenCalledWith('1', 'new-hashed')
      expect(mockSendSecurityNotification).toHaveBeenCalledWith('1', 'password-reset')
      expect(result).toBe('ok')
    })

    it('updates password but leaves emailVerified untouched for a verified account', async () => {
      mockConsumePasswordResetToken.mockResolvedValue({ email: 'test@example.com' })
      mockGetUserAuthInfoByEmail.mockResolvedValue({ id: '1', password: 'old', emailVerified: new Date() })
      mockBcryptHash.mockResolvedValue('new-hashed')

      const result = await applyPasswordReset('token', 'new-pass')

      expect(mockUpdateUserPassword).toHaveBeenCalledWith('1', 'new-hashed')
      expect(mockSetPasswordAndVerifyEmail).not.toHaveBeenCalled()
      expect(mockInvalidateProfileCache).toHaveBeenCalledWith('1')
      expect(mockSendSecurityNotification).toHaveBeenCalledWith('1', 'password-reset')
      expect(result).toBe('ok')
    })
  })
})
