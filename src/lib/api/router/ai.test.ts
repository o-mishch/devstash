import { vi, describe, it, expect, beforeEach } from 'vitest'
import { invoke, expectORPCError } from '@/test/orpc'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({ getCachedVerifiedProAccess: vi.fn() }))
vi.mock('@/lib/ai/openai', () => ({
  getOpenAIClient: vi.fn(),
  AI_MODELS: { DEFAULT: 'model-default', TAG: 'model-tag' },
}))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, checkRateLimit: vi.fn() }
})
vi.mock('@/lib/db/items', () => ({ getItemAiMetadata: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { getOpenAIClient } from '@/lib/ai/openai'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { aiRouter } from './ai'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockGetOpenAIClient = getOpenAIClient as ReturnType<typeof vi.fn>
const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>

function mockCompletion(outputText: string) {
  mockGetOpenAIClient.mockReturnValue({
    responses: { create: vi.fn().mockResolvedValue({ output_text: outputText }) },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockIsPro.mockResolvedValue(true)
  mockCheckRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
})

describe('ai.generateTags', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(aiRouter.generateTags, { itemType: 'snippet', title: 'x' }), 'UNAUTHORIZED')
  })

  it('throws FORBIDDEN for non-Pro users before doing any work', async () => {
    mockIsPro.mockResolvedValue(false)
    await expectORPCError(invoke(aiRouter.generateTags, { itemType: 'snippet', title: 'x' }), 'FORBIDDEN')
    expect(mockGetOpenAIClient).not.toHaveBeenCalled()
  })

  it('throws TOO_MANY_REQUESTS when the limiter denies', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(aiRouter.generateTags, { itemType: 'snippet', title: 'x' }), 'TOO_MANY_REQUESTS')
  })

  it('rejects when neither title nor fileName is provided', async () => {
    await expectORPCError(invoke(aiRouter.generateTags, { itemType: 'snippet' }), 'BAD_REQUEST')
  })

  it('returns normalized tags from the model', async () => {
    mockCompletion(JSON.stringify({ tags: ['React', 'Hooks'] }))
    const result = await invoke(aiRouter.generateTags, { itemType: 'snippet', title: 'useEffect cleanup' })
    expect(result).toEqual(['react', 'hooks'])
  })

  it('throws INTERNAL_SERVER_ERROR when the model output cannot be parsed', async () => {
    mockCompletion('not json at all')
    await expectORPCError(invoke(aiRouter.generateTags, { itemType: 'snippet', title: 'x' }), 'INTERNAL_SERVER_ERROR')
  })
})

describe('ai.generateDescription', () => {
  it('throws FORBIDDEN for non-Pro users', async () => {
    mockIsPro.mockResolvedValue(false)
    await expectORPCError(invoke(aiRouter.generateDescription, { itemType: 'snippet', title: 'x' }), 'FORBIDDEN')
  })

  it('rejects when no usable input is provided', async () => {
    await expectORPCError(invoke(aiRouter.generateDescription, { itemType: 'snippet' }), 'BAD_REQUEST')
  })

  it('returns the generated description', async () => {
    mockCompletion('A small helper that retries with backoff.')
    const result = await invoke(aiRouter.generateDescription, { itemType: 'snippet', title: 'retry helper' })
    expect(result).toEqual({ description: 'A small helper that retries with backoff.' })
  })
})

describe('ai.generateCollectionDescription', () => {
  it('throws FORBIDDEN for non-Pro users', async () => {
    mockIsPro.mockResolvedValue(false)
    await expectORPCError(invoke(aiRouter.generateCollectionDescription, { name: 'React' }), 'FORBIDDEN')
  })

  it('rejects an empty name', async () => {
    await expectORPCError(invoke(aiRouter.generateCollectionDescription, { name: '   ' }), 'BAD_REQUEST')
  })

  it('returns the generated description', async () => {
    mockCompletion('Snippets and patterns for React hooks.')
    const result = await invoke(aiRouter.generateCollectionDescription, { name: 'React' })
    expect(result).toEqual({ description: 'Snippets and patterns for React hooks.' })
  })
})
