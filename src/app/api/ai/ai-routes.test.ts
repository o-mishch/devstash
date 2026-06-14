import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/ai/openai', () => ({
  getOpenAIClient: vi.fn(),
  AI_MODELS: { DEFAULT: 'model-default', TAG: 'model-tag' },
}))
const { mockRateLimitAction } = vi.hoisted(() => ({ mockRateLimitAction: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, rateLimitAction: mockRateLimitAction }
})
vi.mock('@/lib/db/items', () => ({ getItemAiMetadata: vi.fn() }))

import { auth } from '@/auth'
import { getOpenAIClient } from '@/lib/ai/openai'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'

import { POST as TAGS } from './tags/route'
import { POST as DESCRIPTION } from './description/route'
import { POST as COLLECTION_DESCRIPTION } from './collection-description/route'

const mockAuth = auth as ReturnType<typeof vi.fn>
const mockGetOpenAIClient = getOpenAIClient as ReturnType<typeof vi.fn>
const mockGetCachedVerifiedProAccess = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>

type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(handler: RouteHandler, body: unknown) {
  const req = new NextRequest('http://localhost/api/ai', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  const res = await handler(req, { params: Promise.resolve({}) })
  return res.json()
}

function mockCompletion(outputText: string) {
  mockGetOpenAIClient.mockReturnValue({
    responses: { create: vi.fn().mockResolvedValue({ output_text: outputText }) },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
  mockGetCachedVerifiedProAccess.mockResolvedValue(true)
  mockRateLimitAction.mockResolvedValue(null)
})

describe('POST /api/ai/tags', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(TAGS, { itemType: 'snippet', title: 'x' })).status).toBe('unauthorized')
  })

  it('returns FORBIDDEN for non-Pro users before doing any work', async () => {
    mockGetCachedVerifiedProAccess.mockResolvedValue(false)
    const result = await call(TAGS, { itemType: 'snippet', title: 'x' })
    expect(result.status).toBe('forbidden')
    expect(mockGetOpenAIClient).not.toHaveBeenCalled()
  })

  it('returns too_many_requests when the limiter denies', async () => {
    mockRateLimitAction.mockResolvedValue({ status: 'too_many_requests', data: null, message: 'Slow down.' })
    expect((await call(TAGS, { itemType: 'snippet', title: 'x' })).status).toBe('too_many_requests')
  })

  it('returns validation_error when neither title nor fileName is provided', async () => {
    expect((await call(TAGS, { itemType: 'snippet' })).status).toBe('validation_error')
  })

  it('returns ok with normalized tags from the model', async () => {
    mockCompletion(JSON.stringify({ tags: ['React', 'Hooks'] }))
    const result = await call(TAGS, { itemType: 'snippet', title: 'useEffect cleanup' })
    expect(result.status).toBe('ok')
    expect(result.data).toEqual(['react', 'hooks'])
  })

  it('returns internal_error when the model output cannot be parsed', async () => {
    mockCompletion('not json at all')
    expect((await call(TAGS, { itemType: 'snippet', title: 'x' })).status).toBe('internal_error')
  })
})

describe('POST /api/ai/description', () => {
  it('returns FORBIDDEN for non-Pro users', async () => {
    mockGetCachedVerifiedProAccess.mockResolvedValue(false)
    expect((await call(DESCRIPTION, { itemType: 'snippet', title: 'x' })).status).toBe('forbidden')
  })

  it('returns validation_error when no usable input is provided', async () => {
    expect((await call(DESCRIPTION, { itemType: 'snippet' })).status).toBe('validation_error')
  })

  it('returns ok with the generated description', async () => {
    mockCompletion('A small helper that retries with backoff.')
    const result = await call(DESCRIPTION, { itemType: 'snippet', title: 'retry helper' })
    expect(result.status).toBe('ok')
    expect(result.data).toEqual({ description: 'A small helper that retries with backoff.' })
  })
})

describe('POST /api/ai/collection-description', () => {
  it('returns FORBIDDEN for non-Pro users', async () => {
    mockGetCachedVerifiedProAccess.mockResolvedValue(false)
    expect((await call(COLLECTION_DESCRIPTION, { name: 'React' })).status).toBe('forbidden')
  })

  it('returns validation_error when the name is empty', async () => {
    expect((await call(COLLECTION_DESCRIPTION, { name: '   ' })).status).toBe('validation_error')
  })

  it('returns ok with the generated description', async () => {
    mockCompletion('Snippets and patterns for React hooks.')
    const result = await call(COLLECTION_DESCRIPTION, { name: 'React' })
    expect(result.status).toBe('ok')
    expect(result.data).toEqual({ description: 'Snippets and patterns for React hooks.' })
  })
})
