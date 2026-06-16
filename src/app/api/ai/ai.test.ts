import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The route handlers parse + delegate to runProAiGeneration, then map its result to a response.
// runProAiGeneration (the Pro/rate-limit/OpenAI orchestration) is mocked here so the tests exercise
// the route's parse (422), auth (401), and result→response mapping (200/403/429 + Retry-After).
vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  deniedMessage: vi.fn((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('@/lib/ai/description-generation', () => ({
  runProAiGeneration: vi.fn(),
  runOpenAiCompletion: vi.fn(),
  resolveItemImageDimensions: vi.fn(),
}))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { runProAiGeneration } from '@/lib/ai/description-generation'

import { POST as DESCRIPTION } from './description/route'
import { POST as TAGS } from './tags/route'
import { POST as COLLECTION_DESCRIPTION } from './collection-description/route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockRun = runProAiGeneration as ReturnType<typeof vi.fn>

function req(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai', { method: 'POST', body: JSON.stringify(payload) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(true)
})

describe('POST /ai/description', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await DESCRIPTION(req({ itemType: 'snippet', title: 'x' }))
    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('returns 422 when no signal field is provided', async () => {
    const res = await DESCRIPTION(req({ itemType: 'snippet' }))
    expect(res.status).toBe(422)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not Pro', async () => {
    mockRun.mockResolvedValue({ ok: false, status: 403, message: 'This feature requires a Pro subscription.' })
    const res = await DESCRIPTION(req({ itemType: 'snippet', title: 'My Snippet' }))
    expect(res.status).toBe(403)
  })

  it('returns 429 with a Retry-After header when rate-limited', async () => {
    mockRun.mockResolvedValue({ ok: false, status: 429, message: 'slow down', retryAfter: 30 })
    const res = await DESCRIPTION(req({ itemType: 'snippet', title: 'My Snippet' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
  })

  it('returns 200 with the generated description', async () => {
    mockRun.mockResolvedValue({ ok: true, value: { description: 'A neat snippet.' } })
    const res = await DESCRIPTION(req({ itemType: 'snippet', title: 'My Snippet' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ description: 'A neat snippet.' })
    // Pro userId from session is passed to the orchestration (IDOR-safe).
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', isPro: true }))
  })
})

describe('POST /ai/tags', () => {
  it('returns 422 when no signal field is provided', async () => {
    const res = await TAGS(req({ itemType: 'snippet' }))
    expect(res.status).toBe(422)
  })

  it('returns 200 with the suggested tags', async () => {
    mockRun.mockResolvedValue({ ok: true, value: ['react', 'hooks'] })
    const res = await TAGS(req({ itemType: 'snippet', title: 'My Snippet' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(['react', 'hooks'])
  })
})

describe('POST /ai/collection-description', () => {
  it('returns 422 for an empty collection name', async () => {
    const res = await COLLECTION_DESCRIPTION(req({ name: '   ' }))
    expect(res.status).toBe(422)
  })

  it('returns 200 with the generated description', async () => {
    mockRun.mockResolvedValue({ ok: true, value: { description: 'A tidy collection.' } })
    const res = await COLLECTION_DESCRIPTION(req({ name: 'My Collection' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ description: 'A tidy collection.' })
  })
})
