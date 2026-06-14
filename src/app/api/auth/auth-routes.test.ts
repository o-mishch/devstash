import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }))
vi.mock('@/lib/auth/auth-service', () => ({
  registerUser: vi.fn(),
  triggerPasswordReset: vi.fn(),
  applyPasswordReset: vi.fn(),
}))

const { mockRateLimitRoute } = vi.hoisted(() => ({ mockRateLimitRoute: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, rateLimitRoute: mockRateLimitRoute }
})

import { registerUser, triggerPasswordReset, applyPasswordReset } from '@/lib/auth/auth-service'

import { POST as REGISTER } from './register/route'
import { POST as FORGOT } from './forgot-password/route'
import { POST as RESET } from './reset-password/route'

const mockRegisterUser = registerUser as ReturnType<typeof vi.fn>
const mockTriggerPasswordReset = triggerPasswordReset as ReturnType<typeof vi.fn>
const mockApplyPasswordReset = applyPasswordReset as ReturnType<typeof vi.fn>

type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(handler: RouteHandler, path: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/auth/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  const res = await handler(req, { params: Promise.resolve({}) })
  return res.json()
}

const RATE_LIMITED = { body: { status: 'too_many_requests', data: null, message: 'Too many attempts.' }, headers: {} }

beforeEach(() => {
  vi.clearAllMocks()
  mockRateLimitRoute.mockResolvedValue(null)
})

describe('POST /api/auth/register', () => {
  it('returns too_many_requests when rate limited', async () => {
    mockRateLimitRoute.mockResolvedValue(RATE_LIMITED)
    const result = await call(REGISTER, 'register', { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' })
    expect(result.status).toBe('too_many_requests')
    expect(mockRegisterUser).not.toHaveBeenCalled()
  })

  it('returns validation_error for an invalid email', async () => {
    const result = await call(REGISTER, 'register', { name: 'Jo', email: 'not-an-email', password: 'password1', confirmPassword: 'password1' })
    expect(result.status).toBe('validation_error')
    expect(mockRegisterUser).not.toHaveBeenCalled()
  })

  it('returns validation_error when name is missing', async () => {
    const result = await call(REGISTER, 'register', { email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' })
    expect(result.status).toBe('validation_error')
  })

  it('returns validation_error when passwords do not match', async () => {
    const result = await call(REGISTER, 'register', { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password2' })
    expect(result.status).toBe('validation_error')
    expect(mockRegisterUser).not.toHaveBeenCalled()
  })

  it('redirects to /sign-in when verification is skipped', async () => {
    mockRegisterUser.mockResolvedValue('skipped')
    const result = await call(REGISTER, 'register', { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' })
    expect(result.status).toBe('ok')
    expect(result.data.redirectTo).toBe('/sign-in')
  })

  it('redirects to pending register with sent=1 when verification email is sent', async () => {
    mockRegisterUser.mockResolvedValue('sent')
    const result = await call(REGISTER, 'register', { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' })
    expect(result.status).toBe('ok')
    expect(result.data.redirectTo).toContain('pending=1')
    expect(result.data.redirectTo).toContain('sent=1')
    expect(mockRegisterUser).toHaveBeenCalledWith('Jo', 'jo@example.com', 'password1')
  })

  it('redirects with sent=0 when verification email failed to send', async () => {
    mockRegisterUser.mockResolvedValue('failed')
    const result = await call(REGISTER, 'register', { name: 'Jo', email: 'jo@example.com', password: 'password1', confirmPassword: 'password1' })
    expect(result.status).toBe('ok')
    expect(result.data.redirectTo).toContain('sent=0')
  })
})

describe('POST /api/auth/forgot-password', () => {
  it('returns too_many_requests when rate limited', async () => {
    mockRateLimitRoute.mockResolvedValue(RATE_LIMITED)
    const result = await call(FORGOT, 'forgot-password', { email: 'jo@example.com' })
    expect(result.status).toBe('too_many_requests')
    expect(mockTriggerPasswordReset).not.toHaveBeenCalled()
  })

  it('returns validation_error when email is missing', async () => {
    const result = await call(FORGOT, 'forgot-password', {})
    expect(result.status).toBe('validation_error')
    expect(mockTriggerPasswordReset).not.toHaveBeenCalled()
  })

  it('triggers reset and redirects with sent=1 (no account enumeration)', async () => {
    const result = await call(FORGOT, 'forgot-password', { email: 'jo@example.com' })
    expect(result.status).toBe('ok')
    expect(result.data.redirectTo).toContain('sent=1')
    expect(mockTriggerPasswordReset).toHaveBeenCalledWith('jo@example.com')
  })
})

describe('POST /api/auth/reset-password', () => {
  it('returns too_many_requests when rate limited', async () => {
    mockRateLimitRoute.mockResolvedValue(RATE_LIMITED)
    const result = await call(RESET, 'reset-password', { token: 't', password: 'password1', confirmPassword: 'password1' })
    expect(result.status).toBe('too_many_requests')
    expect(mockApplyPasswordReset).not.toHaveBeenCalled()
  })

  it('returns validation_error when token is missing', async () => {
    const result = await call(RESET, 'reset-password', { password: 'password1', confirmPassword: 'password1' })
    expect(result.status).toBe('validation_error')
    expect(mockApplyPasswordReset).not.toHaveBeenCalled()
  })

  it('returns validation_error when passwords do not match', async () => {
    const result = await call(RESET, 'reset-password', { token: 't', password: 'password1', confirmPassword: 'password2' })
    expect(result.status).toBe('validation_error')
    expect(mockApplyPasswordReset).not.toHaveBeenCalled()
  })

  it('returns bad_request when the token is invalid or expired', async () => {
    mockApplyPasswordReset.mockResolvedValue('invalid-token')
    const result = await call(RESET, 'reset-password', { token: 'bad', password: 'password1', confirmPassword: 'password1' })
    expect(result.status).toBe('bad_request')
  })

  it('returns ok when the reset is applied', async () => {
    mockApplyPasswordReset.mockResolvedValue('ok')
    const result = await call(RESET, 'reset-password', { token: 'good', password: 'password1', confirmPassword: 'password1' })
    expect(result.status).toBe('ok')
    expect(mockApplyPasswordReset).toHaveBeenCalledWith('good', 'password1')
  })
})
