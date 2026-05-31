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
}))

vi.mock('@/lib/cache', () => ({
  invalidateProfileCache: vi.fn(),
}))

vi.mock('@/lib/emails/verification', () => ({
  emailVerificationEnabled: vi.fn(),
  sendRegistrationVerification: vi.fn(),
}))

vi.mock('@/lib/emails/password-reset', () => ({
  sendPasswordResetRequest: vi.fn(),
}))

vi.mock('@/lib/tokens', () => ({
  consumePasswordResetToken: vi.fn(),
}))

import {
  validateUserPassword,
  verifyUserPasswordById,
  changeUserPassword,
  registerUser,
  triggerPasswordReset,
  applyPasswordReset,
} from './auth-service'

import { getUserAuthInfoByEmail, getUserAuthMethods, createUser, updateUserPassword } from '@/lib/db/users'
import { invalidateProfileCache } from '@/lib/cache'
import { emailVerificationEnabled, sendRegistrationVerification } from '@/lib/emails/verification'
import { sendPasswordResetRequest } from '@/lib/emails/password-reset'
import { consumePasswordResetToken } from '@/lib/tokens'

const mockBcryptHash = bcrypt.hash as unknown as ReturnType<typeof vi.fn>
const mockBcryptCompare = bcrypt.compare as unknown as ReturnType<typeof vi.fn>

const mockGetUserAuthInfoByEmail = getUserAuthInfoByEmail as ReturnType<typeof vi.fn>
const mockGetUserAuthMethods = getUserAuthMethods as ReturnType<typeof vi.fn>
const mockCreateUser = createUser as ReturnType<typeof vi.fn>
const mockUpdateUserPassword = updateUserPassword as ReturnType<typeof vi.fn>

const mockInvalidateProfileCache = invalidateProfileCache as ReturnType<typeof vi.fn>

const mockEmailVerificationEnabled = emailVerificationEnabled as ReturnType<typeof vi.fn>
const mockSendRegistrationVerification = sendRegistrationVerification as ReturnType<typeof vi.fn>
const mockSendPasswordResetRequest = sendPasswordResetRequest as ReturnType<typeof vi.fn>
const mockConsumePasswordResetToken = consumePasswordResetToken as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('auth-service', () => {
  describe('validateUserPassword', () => {
    it('returns null if user not found or no password', async () => {
      mockGetUserAuthInfoByEmail.mockResolvedValue(null)
      expect(await validateUserPassword('test@example.com', 'pass')).toBeNull()

      mockGetUserAuthInfoByEmail.mockResolvedValue({ password: null })
      expect(await validateUserPassword('test@example.com', 'pass')).toBeNull()
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
    it('hashes password, updates db, and invalidates cache', async () => {
      mockBcryptHash.mockResolvedValue('new-hashed')
      await changeUserPassword('1', 'new-pass')

      expect(mockBcryptHash).toHaveBeenCalledWith('new-pass', 12) // BCRYPT_ROUNDS = 12
      expect(mockUpdateUserPassword).toHaveBeenCalledWith('1', 'new-hashed')
      expect(mockInvalidateProfileCache).toHaveBeenCalledWith('1')
    })
  })

  describe('registerUser', () => {
    it('skips if user already exists', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockGetUserAuthInfoByEmail.mockResolvedValue({ id: '1' })
      
      const result = await registerUser('Test', 'test@example.com', 'pass')
      expect(result).toBe('sent') // Silently mirrors success
      expect(mockCreateUser).not.toHaveBeenCalled()
    })

    it('creates user and sends verification if enabled', async () => {
      mockEmailVerificationEnabled.mockReturnValue(true)
      mockGetUserAuthInfoByEmail.mockResolvedValue(null)
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
      mockGetUserAuthInfoByEmail.mockResolvedValue(null)
      mockBcryptHash.mockResolvedValue('hashed')

      const result = await registerUser('Test', 'test@example.com', 'pass')
      
      expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({
        emailVerified: expect.any(Date)
      }))
      expect(result).toBe('skipped')
    })
  })

  describe('triggerPasswordReset', () => {
    it('does not send email if user not found or no password', async () => {
      mockGetUserAuthInfoByEmail.mockResolvedValue(null)
      await triggerPasswordReset('test@example.com')
      expect(mockSendPasswordResetRequest).not.toHaveBeenCalled()

      mockGetUserAuthInfoByEmail.mockResolvedValue({ password: null })
      await triggerPasswordReset('test@example.com')
      expect(mockSendPasswordResetRequest).not.toHaveBeenCalled()
    })

    it('sends email if user has password', async () => {
      mockGetUserAuthInfoByEmail.mockResolvedValue({ password: 'hashed' })
      await triggerPasswordReset('test@example.com')
      expect(mockSendPasswordResetRequest).toHaveBeenCalledWith('test@example.com')
    })
  })

  describe('applyPasswordReset', () => {
    it('returns invalid-token if token not found', async () => {
      mockConsumePasswordResetToken.mockResolvedValue(null)
      expect(await applyPasswordReset('token', 'pass')).toBe('invalid-token')
    })

    it('returns oauth-only if user has no password', async () => {
      mockConsumePasswordResetToken.mockResolvedValue({ email: 'test@example.com' })
      mockGetUserAuthInfoByEmail.mockResolvedValue({ password: null })
      expect(await applyPasswordReset('token', 'pass')).toBe('oauth-only')
    })

    it('updates password and returns ok', async () => {
      mockConsumePasswordResetToken.mockResolvedValue({ email: 'test@example.com' })
      mockGetUserAuthInfoByEmail.mockResolvedValue({ id: '1', password: 'old' })
      mockBcryptHash.mockResolvedValue('new-hashed')

      const result = await applyPasswordReset('token', 'new-pass')
      
      expect(mockBcryptHash).toHaveBeenCalledWith('new-pass', 12)
      expect(mockUpdateUserPassword).toHaveBeenCalledWith('1', 'new-hashed')
      expect(mockInvalidateProfileCache).toHaveBeenCalledWith('1')
      expect(result).toBe('ok')
    })
  })
})
