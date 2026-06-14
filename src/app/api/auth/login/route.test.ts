import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { MockAuthError } = vi.hoisted(() => {
  class MockAuthError extends Error {
    type: string = ''
    constructor() { super('AuthError') }
  }
  return { MockAuthError }
})

vi.mock('next-auth', () => ({ AuthError: MockAuthError }))
vi.mock('@/auth', () => ({ signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn(), LINK_INTENT_COOKIE: 'link-intent' }))
const { mockRateLimitRoute } = vi.hoisted(() => ({ mockRateLimitRoute: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, rateLimitRoute: mockRateLimitRoute }
})
vi.mock('@/lib/emails/verification', () => ({ emailVerificationEnabled: vi.fn().mockReturnValue(false) }))
vi.mock('@/lib/db/users', () => ({ getUserEmailVerified: vi.fn() }))

import { signIn } from '@/auth'
import { emailVerificationEnabled } from '@/lib/emails/verification'
import { getUserEmailVerified } from '@/lib/db/users'
import { POST } from './route'

const mockSignIn = signIn as ReturnType<typeof vi.fn>
const mockEmailVerificationEnabled = emailVerificationEnabled as ReturnType<typeof vi.fn>
const mockGetUserEmailVerified = getUserEmailVerified as ReturnType<typeof vi.fn>

async function login(email = 'user@example.com', password = 'password123') {
  const req = new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    headers: { 'content-type': 'application/json' },
  })
  const res = await POST(req, { params: Promise.resolve({}) })
  return res.json()
}

const RATE_LIMITED = { body: { status: 'too_many_requests', data: null, message: 'Too many attempts.' }, headers: {} }

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmailVerificationEnabled.mockReturnValue(false)
    mockRateLimitRoute.mockResolvedValue(null)
    mockSignIn.mockResolvedValue(undefined)
  })

  it('returns validation_error when email is missing', async () => {
    const result = await login('', 'password')
    expect(result.status).toBe('validation_error')
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('returns validation_error when password is missing', async () => {
    const result = await login('user@example.com', '')
    expect(result.status).toBe('validation_error')
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('returns ok on successful login and does NOT consult the rate limiter', async () => {
    const result = await login()
    expect(result.status).toBe('ok')
    expect(mockRateLimitRoute).not.toHaveBeenCalled()
  })

  it('does NOT block successful login even when the limiter would deny', async () => {
    mockRateLimitRoute.mockResolvedValue(RATE_LIMITED)
    const result = await login()
    expect(result.status).toBe('ok')
    expect(mockRateLimitRoute).not.toHaveBeenCalled()
  })

  it('returns bad_request for wrong credentials and consults the rate limiter', async () => {
    const credError = new MockAuthError()
    credError.type = 'CredentialsSignin'
    mockSignIn.mockRejectedValue(credError)
    const result = await login()
    expect(result.status).toBe('bad_request')
    expect(mockRateLimitRoute).toHaveBeenCalledWith('login', '127.0.0.1:user@example.com')
  })

  it('returns too_many_requests when rate limit is exceeded on a failed login', async () => {
    const credError = new MockAuthError()
    credError.type = 'CredentialsSignin'
    mockSignIn.mockRejectedValue(credError)
    mockRateLimitRoute.mockResolvedValue(RATE_LIMITED)
    const result = await login()
    expect(result.status).toBe('too_many_requests')
  })

  it('returns forbidden when email is not verified', async () => {
    mockEmailVerificationEnabled.mockReturnValue(true)
    mockGetUserEmailVerified.mockResolvedValue({ emailVerified: null })
    const result = await login()
    expect(result.status).toBe('forbidden')
    expect(result.data.email).toBe('user@example.com')
    expect(mockSignIn).not.toHaveBeenCalled()
    expect(mockRateLimitRoute).not.toHaveBeenCalled()
  })
})
