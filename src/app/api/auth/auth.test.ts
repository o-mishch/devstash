import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { MockAuthError } = vi.hoisted(() => {
  class MockAuthError extends Error {
    type: string = ''
    constructor() {
      super('AuthError')
    }
  }
  return { MockAuthError }
})

// `after` runs the callback immediately so the deferred forgot-password work is observable (Case 9).
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: vi.fn((fn: () => unknown) => { void fn() }),
}))
vi.mock('next-auth', () => ({ AuthError: MockAuthError }))
vi.mock('@/auth', () => ({ signIn: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, checkRateLimit: vi.fn() }
})
vi.mock('@/lib/emails/verification', () => ({ emailVerificationEnabled: vi.fn(), resendVerification: vi.fn() }))
vi.mock('@/lib/auth/auth-service', () => ({
  validateUserPassword: vi.fn(),
  registerUser: vi.fn(),
  triggerPasswordReset: vi.fn(),
  applyPasswordReset: vi.fn(),
}))

import { signIn } from '@/auth'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { emailVerificationEnabled, resendVerification } from '@/lib/emails/verification'
import { validateUserPassword, registerUser, triggerPasswordReset, applyPasswordReset } from '@/lib/auth/auth-service'

import { POST as LOGIN } from './login/route'
import { POST as REGISTER } from './register/route'
import { POST as FORGOT } from './forgot-password/route'
import { POST as RESET } from './reset-password/route'
import { POST as RESEND } from './resend-verification/route'

const mockSignIn = signIn as ReturnType<typeof vi.fn>
const mockRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockEmailVerificationEnabled = emailVerificationEnabled as ReturnType<typeof vi.fn>
const mockValidateUserPassword = validateUserPassword as ReturnType<typeof vi.fn>
const mockRegisterUser = registerUser as ReturnType<typeof vi.fn>
const mockTriggerPasswordReset = triggerPasswordReset as ReturnType<typeof vi.fn>
const mockApplyPasswordReset = applyPasswordReset as ReturnType<typeof vi.fn>
const mockResendVerification = resendVerification as ReturnType<typeof vi.fn>

function post(path: string, payload?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/auth/${path}`, {
    method: 'POST',
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  mockEmailVerificationEnabled.mockReturnValue(false)
  mockSignIn.mockResolvedValue(undefined)
  // Default: a valid, verified credential user (password validated first now — Cases 5/9).
  mockValidateUserPassword.mockResolvedValue({ id: 'u1', email: 'user@example.com', emailVerified: new Date() })
})

describe('POST /auth/login', () => {
  it('returns 422 for a missing email', async () => {
    const res = await LOGIN(post('login', { email: '', password: 'password' }))
    expect(res.status).toBe(422)
    expect(mockValidateUserPassword).not.toHaveBeenCalled()
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('returns 422 for a missing password', async () => {
    const res = await LOGIN(post('login', { email: 'user@example.com', password: '' }))
    expect(res.status).toBe(422)
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('returns 204 on a successful login and does NOT consult the rate limiter', async () => {
    const res = await LOGIN(post('login', { email: 'user@example.com', password: 'password123' }))
    expect(res.status).toBe(204)
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('returns generic 400 and consumes the budget when the password is wrong (Case 5)', async () => {
    mockValidateUserPassword.mockResolvedValue(null)
    const res = await LOGIN(post('login', { email: 'user@example.com', password: 'password123' }))
    expect(res.status).toBe(400)
    expect(mockRateLimit).toHaveBeenCalledWith('login', '127.0.0.1:user@example.com')
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('returns 429 when the limiter denies a wrong-password attempt', async () => {
    mockValidateUserPassword.mockResolvedValue(null)
    mockRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    const res = await LOGIN(post('login', { email: 'user@example.com', password: 'password123' }))
    expect(res.status).toBe(429)
  })

  it('returns a generic 400 (no email leak) for a WRONG password on an unverified account (Case 5)', async () => {
    mockEmailVerificationEnabled.mockReturnValue(true)
    mockValidateUserPassword.mockResolvedValue(null) // wrong password — never reveals unverified state
    const res = await LOGIN(post('login', { email: 'user@example.com', password: 'wrong' }))
    expect(res.status).toBe(400)
    expect(await res.json()).not.toHaveProperty('data')
    expect(mockRateLimit).toHaveBeenCalled() // budget consumed
  })

  it('returns the typed 403 only on a CORRECT password for an unverified account, no budget consumed (Case 5)', async () => {
    mockEmailVerificationEnabled.mockReturnValue(true)
    mockValidateUserPassword.mockResolvedValue({ id: 'u1', email: 'user@example.com', emailVerified: null })
    const res = await LOGIN(post('login', { email: 'user@example.com', password: 'password123' }))
    expect(res.status).toBe(403)
    expect((await res.json()).data.email).toBe('user@example.com')
    expect(mockSignIn).not.toHaveBeenCalled()
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('signs in on a correct password for a verified account (verification enabled)', async () => {
    mockEmailVerificationEnabled.mockReturnValue(true)
    mockValidateUserPassword.mockResolvedValue({ id: 'u1', email: 'user@example.com', emailVerified: new Date() })
    const res = await LOGIN(post('login', { email: 'user@example.com', password: 'password123' }))
    expect(res.status).toBe(204)
    expect(mockSignIn).toHaveBeenCalled()
  })
})

describe('POST /auth/register', () => {
  it('returns 429 when rate limited', async () => {
    mockRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    const res = await REGISTER(post('register', { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' }))
    expect(res.status).toBe(429)
    expect(mockRegisterUser).not.toHaveBeenCalled()
  })

  it('returns 422 for an invalid email', async () => {
    const res = await REGISTER(post('register', { name: 'Jo', email: 'not-an-email', password: 'password1', confirmPassword: 'password1' }))
    expect(res.status).toBe(422)
    expect(mockRegisterUser).not.toHaveBeenCalled()
  })

  it('returns 422 for mismatched passwords', async () => {
    const res = await REGISTER(post('register', { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password2' }))
    expect(res.status).toBe(422)
    expect(mockRegisterUser).not.toHaveBeenCalled()
  })

  it('returns 200 redirecting to /sign-in when verification is skipped', async () => {
    mockRegisterUser.mockResolvedValue('skipped')
    const res = await REGISTER(post('register', { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).redirectTo).toBe('/sign-in')
  })

  it('returns 200 redirecting to pending register with sent=1 when the email is sent', async () => {
    mockRegisterUser.mockResolvedValue('sent')
    const res = await REGISTER(post('register', { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' }))
    const body = await res.json()
    expect(body.redirectTo).toContain('pending=1')
    expect(body.redirectTo).toContain('sent=1')
    expect(mockRegisterUser).toHaveBeenCalledWith('Jo', 'jo@example.com', 'password1')
  })

  it('redirects with sent=0 when the verification email failed to send', async () => {
    mockRegisterUser.mockResolvedValue('failed')
    const res = await REGISTER(post('register', { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' }))
    expect((await res.json()).redirectTo).toContain('sent=0')
  })
})

describe('POST /auth/forgot-password', () => {
  it('returns 429 when rate limited', async () => {
    mockRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    const res = await FORGOT(post('forgot-password', { email: 'jo@example.com' }))
    expect(res.status).toBe(429)
    expect(mockTriggerPasswordReset).not.toHaveBeenCalled()
  })

  it('returns 422 for a missing email', async () => {
    const res = await FORGOT(post('forgot-password', { email: '' }))
    expect(res.status).toBe(422)
    expect(mockTriggerPasswordReset).not.toHaveBeenCalled()
  })

  it('triggers reset and returns 200 with sent=1 (no account enumeration)', async () => {
    const res = await FORGOT(post('forgot-password', { email: 'jo@example.com' }))
    expect(res.status).toBe(200)
    expect((await res.json()).redirectTo).toContain('sent=1')
    expect(mockTriggerPasswordReset).toHaveBeenCalledWith('jo@example.com')
  })
})

describe('POST /auth/reset-password', () => {
  it('returns 429 when rate limited', async () => {
    mockRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    const res = await RESET(post('reset-password', { token: 't', password: 'password1', confirmPassword: 'password1' }))
    expect(res.status).toBe(429)
    expect(mockApplyPasswordReset).not.toHaveBeenCalled()
  })

  it('returns 422 for a missing token', async () => {
    const res = await RESET(post('reset-password', { token: '', password: 'password1', confirmPassword: 'password1' }))
    expect(res.status).toBe(422)
    expect(mockApplyPasswordReset).not.toHaveBeenCalled()
  })

  it('returns 422 for mismatched passwords', async () => {
    const res = await RESET(post('reset-password', { token: 't', password: 'password1', confirmPassword: 'password2' }))
    expect(res.status).toBe(422)
    expect(mockApplyPasswordReset).not.toHaveBeenCalled()
  })

  it('returns 400 when the token is invalid or expired', async () => {
    mockApplyPasswordReset.mockResolvedValue('invalid-token')
    const res = await RESET(post('reset-password', { token: 'bad', password: 'password1', confirmPassword: 'password1' }))
    expect(res.status).toBe(400)
  })

  it('returns 204 when the reset is applied', async () => {
    mockApplyPasswordReset.mockResolvedValue('ok')
    const res = await RESET(post('reset-password', { token: 'good', password: 'password1', confirmPassword: 'password1' }))
    expect(res.status).toBe(204)
    expect(mockApplyPasswordReset).toHaveBeenCalledWith('good', 'password1')
  })
})

describe('POST /auth/resend-verification', () => {
  it('returns 429 when the IP guard denies', async () => {
    mockRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    const res = await RESEND(post('resend-verification', { email: 'jo@example.com' }))
    expect(res.status).toBe(429)
    expect(mockResendVerification).not.toHaveBeenCalled()
  })

  it('returns 422 for a missing email', async () => {
    const res = await RESEND(post('resend-verification', { email: '' }))
    expect(res.status).toBe(422)
    expect(mockResendVerification).not.toHaveBeenCalled()
  })

  it('returns 429 when the per-IP+email guard denies', async () => {
    mockRateLimit
      .mockResolvedValueOnce({ success: true, retryAfter: 0 }) // IP guard passes
      .mockResolvedValueOnce({ success: false, retryAfter: 60 }) // send guard denies
    const res = await RESEND(post('resend-verification', { email: 'jo@example.com' }))
    expect(res.status).toBe(429)
    expect(mockResendVerification).not.toHaveBeenCalled()
  })

  it('returns 204 and sends the verification email on success', async () => {
    const res = await RESEND(post('resend-verification', { email: 'jo@example.com' }))
    expect(res.status).toBe(204)
    expect(mockResendVerification).toHaveBeenCalledWith('jo@example.com')
  })
})
