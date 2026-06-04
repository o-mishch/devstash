import { vi, describe, it, expect, beforeEach } from 'vitest'

const { MockAuthError } = vi.hoisted(() => {
  class MockAuthError extends Error {
    type: string = ''
    constructor() { super('AuthError') }
  }
  return { MockAuthError }
})

vi.mock('next-auth', () => ({ AuthError: MockAuthError }))
vi.mock('@/auth', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  auth: vi.fn(),
  LINK_INTENT_COOKIE: 'link-intent',
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAction: vi.fn(),
  getActionIP: vi.fn().mockResolvedValue('127.0.0.1'),
}))
vi.mock('@/lib/emails/verification', () => ({
  emailVerificationEnabled: vi.fn().mockReturnValue(false),
}))
vi.mock('@/lib/db/users', () => ({
  getUserEmailVerified: vi.fn(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ set: vi.fn() }),
}))

import { signIn } from '@/auth'
import { rateLimitAction } from '@/lib/rate-limit'
import { emailVerificationEnabled } from '@/lib/emails/verification'
import { getUserEmailVerified } from '@/lib/db/users'
import { signInWithCredentials } from './login'

const mockSignIn = signIn as ReturnType<typeof vi.fn>
const mockRateLimitAction = rateLimitAction as ReturnType<typeof vi.fn>
const mockEmailVerificationEnabled = emailVerificationEnabled as ReturnType<typeof vi.fn>
const mockGetUserEmailVerified = getUserEmailVerified as ReturnType<typeof vi.fn>

function makeForm(email = 'user@example.com', password = 'password123') {
  const form = new FormData()
  form.set('email', email)
  form.set('password', password)
  return form
}

describe('signInWithCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmailVerificationEnabled.mockReturnValue(false)
    mockRateLimitAction.mockResolvedValue(null) // not rate limited by default
    mockSignIn.mockResolvedValue(undefined) // success by default
  })

  it('returns validation_error when email is missing', async () => {
    const result = await signInWithCredentials(null, makeForm('', 'password'))
    expect(result.status).toBe('validation_error')
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('returns validation_error when password is missing', async () => {
    const result = await signInWithCredentials(null, makeForm('user@example.com', ''))
    expect(result.status).toBe('validation_error')
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('returns ok on successful login and does NOT call rateLimitAction', async () => {
    const result = await signInWithCredentials(null, makeForm())
    expect(result.status).toBe('ok')
    expect(mockRateLimitAction).not.toHaveBeenCalled()
  })

  it('does NOT block successful login even after many prior calls', async () => {
    // Simulate: rate limiter would deny if checked
    mockRateLimitAction.mockResolvedValue({ status: 'too_many_requests', data: null, message: 'Too many attempts.' })
    mockSignIn.mockResolvedValue(undefined) // credentials are correct

    const result = await signInWithCredentials(null, makeForm())
    expect(result.status).toBe('ok')
    // rateLimitAction must never be consulted for a successful login
    expect(mockRateLimitAction).not.toHaveBeenCalled()
  })

  it('returns bad_request for wrong credentials and calls rateLimitAction', async () => {
    const credError = new MockAuthError()
    credError.type = 'CredentialsSignin'
    mockSignIn.mockRejectedValue(credError)

    const result = await signInWithCredentials(null, makeForm())
    expect(result.status).toBe('bad_request')
    expect(mockRateLimitAction).toHaveBeenCalledWith('login', '127.0.0.1:user@example.com')
  })

  it('returns too_many_requests when rate limit is exceeded on a failed login', async () => {
    const credError = new MockAuthError()
    credError.type = 'CredentialsSignin'
    mockSignIn.mockRejectedValue(credError)
    mockRateLimitAction.mockResolvedValue({ status: 'too_many_requests', data: null, message: 'Too many attempts.' })

    const result = await signInWithCredentials(null, makeForm())
    expect(result.status).toBe('too_many_requests')
  })

  it('returns forbidden when email is not verified', async () => {
    mockEmailVerificationEnabled.mockReturnValue(true)
    mockGetUserEmailVerified.mockResolvedValue({ emailVerified: null })

    const result = await signInWithCredentials(null, makeForm())
    expect(result.status).toBe('forbidden')
    expect(mockSignIn).not.toHaveBeenCalled()
    expect(mockRateLimitAction).not.toHaveBeenCalled()
  })
})
