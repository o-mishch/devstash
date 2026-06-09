import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockRateLimitAction,
  mockFinalizeCheckoutReturn,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRateLimitAction: vi.fn(),
  mockFinalizeCheckoutReturn: vi.fn(),
}))

vi.mock('@/lib/session', () => ({
  getCachedSession: mockGetSession,
}))

vi.mock('@/lib/infra/rate-limit', () => ({
  rateLimitAction: mockRateLimitAction,
}))

vi.mock('@/lib/billing/checkout/checkout-return-params', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/checkout/checkout-return-params')>()
  return {
    ...actual,
    buildCheckoutReturnRedirectPath: (notification: { type: string; messageKey?: string }) => {
      if (notification.type === 'info' && notification.messageKey) {
        return `/settings?checkout=info&reason=${encodeURIComponent(notification.messageKey)}`
      }
      return `/settings?checkout=${notification.type}`
    },
  }
})

vi.mock('@/lib/billing/checkout/finalize-checkout-return', () => ({
  finalizeCheckoutReturn: mockFinalizeCheckoutReturn,
}))

vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { GET } from './route'

const routeContext = { params: Promise.resolve({}) }

function makeRequest(sessionId?: string) {
  const url = new URL('http://localhost:3000/api/billing/checkout-return')
  if (sessionId) {
    url.searchParams.set('session_id', sessionId)
  }
  return new NextRequest(url)
}

describe('GET /api/billing/checkout-return', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockRateLimitAction.mockResolvedValue(null)
    mockFinalizeCheckoutReturn.mockResolvedValue({ type: 'success' })
  })

  it('redirects unauthenticated users to sign-in with checkout return callback', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(makeRequest('cs_test_123'), routeContext)

    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toContain('/sign-in')
    expect(location).toContain('callbackUrl=')
    expect(decodeURIComponent(location ?? '')).toContain('session_id=cs_test_123')
    expect(mockFinalizeCheckoutReturn).not.toHaveBeenCalled()
  })

  it('redirects to settings when rate limited', async () => {
    mockRateLimitAction.mockResolvedValue({
      status: 'too_many_requests',
      data: null,
      message: 'Too many attempts. Please try again shortly.',
    })

    const response = await GET(makeRequest('cs_test_123'), routeContext)

    expect(mockRateLimitAction).toHaveBeenCalledWith('stripeSync', 'user-1')
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/settings?checkout=info&reason=rate_limited')
    expect(mockFinalizeCheckoutReturn).not.toHaveBeenCalled()
  })

  it('falls back to passive sync when session_id is invalid', async () => {
    mockFinalizeCheckoutReturn.mockResolvedValue({ type: 'syncing' })

    const response = await GET(makeRequest('bad_session'), routeContext)

    expect(mockFinalizeCheckoutReturn).toHaveBeenCalledWith({
      userId: 'user-1',
      checkoutSuccess: true,
      sessionId: undefined,
    })
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/settings?checkout=syncing')
  })

  it('finalizes checkout and redirects to the success toast', async () => {
    const response = await GET(makeRequest('cs_test_123'), routeContext)

    expect(mockFinalizeCheckoutReturn).toHaveBeenCalledWith({
      userId: 'user-1',
      checkoutSuccess: true,
      sessionId: 'cs_test_123',
    })
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/settings?checkout=success')
  })

  it('redirects with syncing recovery when finalization throws', async () => {
    mockFinalizeCheckoutReturn.mockRejectedValue(new Error('Stripe unavailable'))

    const response = await GET(makeRequest('cs_test_123'), routeContext)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/settings?checkout=syncing')
  })

  it('finalizes checkout without session_id when param is omitted', async () => {
    const response = await GET(makeRequest(), routeContext)

    expect(mockFinalizeCheckoutReturn).toHaveBeenCalledWith({
      userId: 'user-1',
      checkoutSuccess: true,
      sessionId: undefined,
    })
    expect(response.status).toBe(307)
  })

  it('redirects to settings when finalization returns null', async () => {
    mockFinalizeCheckoutReturn.mockResolvedValue(null)

    const response = await GET(makeRequest('cs_test_123'), routeContext)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/settings')
  })

  it('redirects with syncing outcome when finalization returns syncing', async () => {
    mockFinalizeCheckoutReturn.mockResolvedValue({ type: 'syncing' })

    const response = await GET(makeRequest('cs_test_123'), routeContext)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/settings?checkout=syncing')
  })

  it('redirects with info outcome when finalization returns error', async () => {
    mockFinalizeCheckoutReturn.mockResolvedValue({
      type: 'info',
      messageKey: 'activation_failed',
    })

    const response = await GET(makeRequest('cs_test_123'), routeContext)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('checkout=info')
    expect(response.headers.get('location')).toContain('reason=activation_failed')
  })

  it('redirects with forbidden message when session belongs to another user', async () => {
    mockFinalizeCheckoutReturn.mockResolvedValue({
      type: 'info',
      messageKey: 'session_owner_mismatch',
    })

    const response = await GET(makeRequest('cs_test_123'), routeContext)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('checkout=info')
    expect(response.headers.get('location')).toContain('reason=session_owner_mismatch')
  })
})
