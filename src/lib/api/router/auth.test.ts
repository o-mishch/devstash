import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ORPCError } from '@orpc/server'
import { invoke, expectORPCError } from '@/test/orpc'

const { MockAuthError } = vi.hoisted(() => {
  class MockAuthError extends Error {
    type: string = ''
    constructor() { super('AuthError') }
  }
  return { MockAuthError }
})

vi.mock('next-auth', () => ({ AuthError: MockAuthError }))
vi.mock('@/auth', () => ({ signIn: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, checkRateLimit: vi.fn() }
})
vi.mock('@/lib/emails/verification', () => ({ emailVerificationEnabled: vi.fn(), resendVerification: vi.fn() }))
vi.mock('@/lib/db/users', () => ({ getUserEmailVerified: vi.fn() }))
vi.mock('@/lib/auth/auth-service', () => ({
  registerUser: vi.fn(),
  triggerPasswordReset: vi.fn(),
  applyPasswordReset: vi.fn(),
}))

import { signIn } from '@/auth'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { emailVerificationEnabled, resendVerification } from '@/lib/emails/verification'
import { getUserEmailVerified } from '@/lib/db/users'
import { registerUser, triggerPasswordReset, applyPasswordReset } from '@/lib/auth/auth-service'
import { authRouter } from './auth'

const mockSignIn = signIn as ReturnType<typeof vi.fn>
const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockEmailVerificationEnabled = emailVerificationEnabled as ReturnType<typeof vi.fn>
const mockGetUserEmailVerified = getUserEmailVerified as ReturnType<typeof vi.fn>
const mockRegisterUser = registerUser as ReturnType<typeof vi.fn>
const mockTriggerPasswordReset = triggerPasswordReset as ReturnType<typeof vi.fn>
const mockApplyPasswordReset = applyPasswordReset as ReturnType<typeof vi.fn>
const mockResendVerification = resendVerification as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  mockEmailVerificationEnabled.mockReturnValue(false)
  mockSignIn.mockResolvedValue(undefined)
})

describe('auth.login', () => {
  it('rejects a missing email', async () => {
    await expectORPCError(invoke(authRouter.login, { email: '', password: 'password' }), 'BAD_REQUEST')
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('rejects a missing password', async () => {
    await expectORPCError(invoke(authRouter.login, { email: 'user@example.com', password: '' }), 'BAD_REQUEST')
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('resolves on a successful login and does NOT consult the rate limiter', async () => {
    await invoke(authRouter.login, { email: 'user@example.com', password: 'password123' })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })

  it('throws BAD_REQUEST for wrong credentials and consults the rate limiter', async () => {
    const credError = new MockAuthError()
    credError.type = 'CredentialsSignin'
    mockSignIn.mockRejectedValue(credError)
    await expectORPCError(invoke(authRouter.login, { email: 'user@example.com', password: 'password123' }), 'BAD_REQUEST')
    expect(mockCheckRateLimit).toHaveBeenCalledWith('login', '127.0.0.1:user@example.com')
  })

  it('throws TOO_MANY_REQUESTS when the limiter denies a failed login', async () => {
    const credError = new MockAuthError()
    credError.type = 'CredentialsSignin'
    mockSignIn.mockRejectedValue(credError)
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(authRouter.login, { email: 'user@example.com', password: 'password123' }), 'TOO_MANY_REQUESTS')
  })

  it('throws the typed EMAIL_NOT_VERIFIED error carrying the email', async () => {
    mockEmailVerificationEnabled.mockReturnValue(true)
    mockGetUserEmailVerified.mockResolvedValue({ emailVerified: null })
    const promise = invoke(authRouter.login, { email: 'user@example.com', password: 'password123' })
    await expectORPCError(promise, 'EMAIL_NOT_VERIFIED')
    await promise.catch((error) => expect((error as ORPCError<string, { email: string }>).data.email).toBe('user@example.com'))
    expect(mockSignIn).not.toHaveBeenCalled()
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
  })
})

describe('auth.register', () => {
  it('throws TOO_MANY_REQUESTS when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(authRouter.register, { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' }), 'TOO_MANY_REQUESTS')
    expect(mockRegisterUser).not.toHaveBeenCalled()
  })

  it('rejects an invalid email', async () => {
    await expectORPCError(invoke(authRouter.register, { name: 'Jo', email: 'not-an-email', password: 'password1', confirmPassword: 'password1' }), 'BAD_REQUEST')
    expect(mockRegisterUser).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords', async () => {
    await expectORPCError(invoke(authRouter.register, { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password2' }), 'BAD_REQUEST')
    expect(mockRegisterUser).not.toHaveBeenCalled()
  })

  it('redirects to /sign-in when verification is skipped', async () => {
    mockRegisterUser.mockResolvedValue('skipped')
    const result = await invoke(authRouter.register, { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' })
    expect(result).toEqual({ redirectTo: '/sign-in' })
  })

  it('redirects to pending register with sent=1 when the verification email is sent', async () => {
    mockRegisterUser.mockResolvedValue('sent')
    const result = await invoke(authRouter.register, { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' })
    expect(result.redirectTo).toContain('pending=1')
    expect(result.redirectTo).toContain('sent=1')
    expect(mockRegisterUser).toHaveBeenCalledWith('Jo', 'jo@example.com', 'password1')
  })

  it('redirects with sent=0 when the verification email failed to send', async () => {
    mockRegisterUser.mockResolvedValue('failed')
    const result = await invoke(authRouter.register, { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' })
    expect(result.redirectTo).toContain('sent=0')
  })
})

describe('auth.forgotPassword', () => {
  it('throws TOO_MANY_REQUESTS when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(authRouter.forgotPassword, { email: 'jo@example.com' }), 'TOO_MANY_REQUESTS')
    expect(mockTriggerPasswordReset).not.toHaveBeenCalled()
  })

  it('rejects a missing email', async () => {
    await expectORPCError(invoke(authRouter.forgotPassword, { email: '' }), 'BAD_REQUEST')
    expect(mockTriggerPasswordReset).not.toHaveBeenCalled()
  })

  it('triggers reset and redirects with sent=1 (no account enumeration)', async () => {
    const result = await invoke(authRouter.forgotPassword, { email: 'jo@example.com' })
    expect(result.redirectTo).toContain('sent=1')
    expect(mockTriggerPasswordReset).toHaveBeenCalledWith('jo@example.com')
  })
})

describe('auth.resetPassword', () => {
  it('throws TOO_MANY_REQUESTS when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(authRouter.resetPassword, { token: 't', password: 'password1', confirmPassword: 'password1' }), 'TOO_MANY_REQUESTS')
    expect(mockApplyPasswordReset).not.toHaveBeenCalled()
  })

  it('rejects a missing token', async () => {
    await expectORPCError(invoke(authRouter.resetPassword, { token: '', password: 'password1', confirmPassword: 'password1' }), 'BAD_REQUEST')
    expect(mockApplyPasswordReset).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords', async () => {
    await expectORPCError(invoke(authRouter.resetPassword, { token: 't', password: 'password1', confirmPassword: 'password2' }), 'BAD_REQUEST')
    expect(mockApplyPasswordReset).not.toHaveBeenCalled()
  })

  it('throws BAD_REQUEST when the token is invalid or expired', async () => {
    mockApplyPasswordReset.mockResolvedValue('invalid-token')
    await expectORPCError(invoke(authRouter.resetPassword, { token: 'bad', password: 'password1', confirmPassword: 'password1' }), 'BAD_REQUEST')
  })

  it('resolves when the reset is applied', async () => {
    mockApplyPasswordReset.mockResolvedValue('ok')
    await invoke(authRouter.resetPassword, { token: 'good', password: 'password1', confirmPassword: 'password1' })
    expect(mockApplyPasswordReset).toHaveBeenCalledWith('good', 'password1')
  })
})

describe('auth.resendVerification', () => {
  it('throws TOO_MANY_REQUESTS when the IP guard denies', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(authRouter.resendVerification, { email: 'jo@example.com' }), 'TOO_MANY_REQUESTS')
    expect(mockResendVerification).not.toHaveBeenCalled()
  })

  it('rejects a missing email', async () => {
    await expectORPCError(invoke(authRouter.resendVerification, { email: '' }), 'BAD_REQUEST')
    expect(mockResendVerification).not.toHaveBeenCalled()
  })

  it('sends the verification email on success', async () => {
    await invoke(authRouter.resendVerification, { email: 'jo@example.com' })
    expect(mockResendVerification).toHaveBeenCalledWith('jo@example.com')
  })
})
