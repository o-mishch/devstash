import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readJson } from '@/test/matchers'
import { NextRequest } from 'next/server'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  deniedMessage: vi.fn((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { authedRoute, authedRouteWithParams } from './route'
import { json } from './http'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockRateLimit = checkRateLimit as ReturnType<typeof vi.fn>

const request = () => new NextRequest('http://localhost/api/test', { method: 'POST' })

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(false)
  mockRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
})

describe('authedRoute', () => {
  it('returns 401 with a message when there is no session', async () => {
    mockSession.mockResolvedValue(null)
    const handler = authedRoute({}, () => Promise.resolve(json({ ok: true })))
    const res = await handler(request())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ message: 'Not authenticated.' })
  })

  it('injects an IDOR-safe ctx (session userId + isPro) into the handler', async () => {
    mockIsPro.mockResolvedValue(true)
    const handler = authedRoute({}, ({ userId, isPro }) => Promise.resolve(json({ userId, isPro })))
    const res = await handler(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'user-1', isPro: true })
  })

  it('returns 429 with a Retry-After header when rate-limited', async () => {
    mockRateLimit.mockResolvedValue({ success: false, retryAfter: 42 })
    const handler = authedRoute({ rateLimit: 'itemMutation' }, () => Promise.resolve(json({ ok: true })))
    const res = await handler(request())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(mockRateLimit).toHaveBeenCalledWith('itemMutation', 'user-1')
  })

  it('returns 500 when the handler throws an unexpected error', async () => {
    const handler = authedRoute({}, () => {
      throw new Error('boom')
    })
    const res = await handler(request())
    expect(res.status).toBe(500)
    expect((await readJson(res)).message).toMatch(/something went wrong/i)
  })
})

describe('authedRouteWithParams', () => {
  it('returns 401 before resolving params when there is no session', async () => {
    mockSession.mockResolvedValue(null)
    const handler = authedRouteWithParams<{ id: string }>({}, ({ params }) => Promise.resolve(json(params)))
    const res = await handler(request(), { params: Promise.resolve({ id: 'x' }) })
    expect(res.status).toBe(401)
  })

  it('resolves the awaited params and passes them to the handler', async () => {
    const handler = authedRouteWithParams<{ id: string }>({}, ({ userId, params }) =>
      Promise.resolve(json({ userId, id: params.id })),
    )
    const res = await handler(request(), { params: Promise.resolve({ id: 'col-9' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'user-1', id: 'col-9' })
  })
})
