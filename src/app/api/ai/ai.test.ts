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
  getAiUsage: vi.fn(),
  getBrainDumpUsage: vi.fn(),
}))
vi.mock('@/lib/ai/description-generation', () => ({
  runProAiGeneration: vi.fn(),
  runOpenAiCompletion: vi.fn(),
  resolveItemImageDimensions: vi.fn(),
}))
// Keeps the explain route from importing Prisma; the DB read lives inside the mocked runProAiGeneration.
vi.mock('@/lib/db/items', () => ({ getItemExplainContext: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { runProAiGeneration, runOpenAiCompletion } from '@/lib/ai/description-generation'
import { getAiUsage, getBrainDumpUsage } from '@/lib/infra/rate-limit'
import { getItemExplainContext } from '@/lib/db/items'
import { EXPLAIN_MAX_INPUT_CHARS, OPTIMIZE_MAX_INPUT_CHARS } from '@/lib/utils/constants'

import { POST as DESCRIPTION } from './description/route'
import { POST as TAGS } from './tags/route'
import { POST as COLLECTION_DESCRIPTION } from './collection-description/route'
import { POST as EXPLAIN } from './explain/route'
import { POST as OPTIMIZE } from './optimize/route'
import { GET as USAGE } from './usage/route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockIsPro = getCachedVerifiedProAccess as ReturnType<typeof vi.fn>
const mockRun = runProAiGeneration as ReturnType<typeof vi.fn>
const mockCompletion = runOpenAiCompletion as ReturnType<typeof vi.fn>
const mockGetContext = getItemExplainContext as ReturnType<typeof vi.fn>
const mockGetAiUsage = getAiUsage as ReturnType<typeof vi.fn>
const mockGetBrainDumpUsage = getBrainDumpUsage as ReturnType<typeof vi.fn>

// Capture the `execute` callback the route hands to runProAiGeneration so the route's own DB read,
// null-content guard, and content truncation (which the full mock above would otherwise skip) are
// exercised directly. Returns the captured callback.
type ExecuteFn = (client: unknown, data: { itemId: string }) => Promise<unknown>
async function runExplainExecute(payload: unknown): Promise<ExecuteFn> {
  let captured: ExecuteFn | null = null
  mockRun.mockImplementation(({ execute }: { execute: ExecuteFn }) => {
    captured = execute
    return { ok: true, value: { explanation: 'unused' } }
  })
  await EXPLAIN(req(payload))
  if (!captured) throw new Error('execute callback was never passed to runProAiGeneration')
  return captured
}

// Same capture trick for the optimize route (see runExplainExecute) — exercises its DB read,
// null-content guard, and input truncation directly.
async function runOptimizeExecute(payload: unknown): Promise<ExecuteFn> {
  let captured: ExecuteFn | null = null
  mockRun.mockImplementation(({ execute }: { execute: ExecuteFn }) => {
    captured = execute
    return { ok: true, value: { prompt: 'unused' } }
  })
  await OPTIMIZE(req(payload))
  if (!captured) throw new Error('execute callback was never passed to runProAiGeneration')
  return captured
}

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

describe('POST /ai/explain', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await EXPLAIN(req({ itemId: 'item-1' }))
    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('returns 422 when itemId is missing', async () => {
    const res = await EXPLAIN(req({}))
    expect(res.status).toBe(422)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not Pro', async () => {
    mockRun.mockResolvedValue({ ok: false, status: 403, message: 'This feature requires a Pro subscription.' })
    const res = await EXPLAIN(req({ itemId: 'item-1' }))
    expect(res.status).toBe(403)
  })

  it('returns 429 with a Retry-After header when rate-limited', async () => {
    mockRun.mockResolvedValue({ ok: false, status: 429, message: 'slow down', retryAfter: 30 })
    const res = await EXPLAIN(req({ itemId: 'item-1' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
  })

  it('returns 500 when the OpenAI client is unconfigured', async () => {
    mockRun.mockResolvedValue({ ok: false, status: 500, message: 'AI code explanation is not configured.' })
    const res = await EXPLAIN(req({ itemId: 'item-1' }))
    expect(res.status).toBe(500)
  })

  it('returns 200 with the generated explanation', async () => {
    mockRun.mockResolvedValue({ ok: true, value: { explanation: 'It memoizes a fetch.' } })
    const res = await EXPLAIN(req({ itemId: 'item-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ explanation: 'It memoizes a fetch.' })
    // Pro userId from session is passed to the orchestration (IDOR-safe).
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', isPro: true }))
  })

  it('execute reads the item scoped to the session userId and yields null when content is empty', async () => {
    mockGetContext.mockResolvedValue({ itemType: 'snippet', content: null, language: null })
    const execute = await runExplainExecute({ itemId: 'item-1' })

    await expect(execute({}, { itemId: 'item-1' })).resolves.toBeNull()
    // IDOR-safe: the DB read is scoped to the session userId, not anything from the request body.
    expect(mockGetContext).toHaveBeenCalledWith('user-1', 'item-1')
    expect(mockCompletion).not.toHaveBeenCalled()
  })

  it('execute truncates content to the input cap before calling the model', async () => {
    const oversized = 'a'.repeat(EXPLAIN_MAX_INPUT_CHARS + 500)
    mockGetContext.mockResolvedValue({ itemType: 'snippet', content: oversized, language: 'ts' })
    mockCompletion.mockResolvedValue({ explanation: 'done' })
    const execute = await runExplainExecute({ itemId: 'item-1' })

    await expect(execute({}, { itemId: 'item-1' })).resolves.toEqual({ explanation: 'done' })
    const userMessage = (mockCompletion.mock.calls[0][1] as { input: string }).input
    expect(userMessage).toContain('a'.repeat(EXPLAIN_MAX_INPUT_CHARS))
    expect(userMessage).not.toContain('a'.repeat(EXPLAIN_MAX_INPUT_CHARS + 1))
  })
})

describe('POST /ai/optimize', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await OPTIMIZE(req({ itemId: 'item-1' }))
    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('returns 422 when itemId is missing', async () => {
    const res = await OPTIMIZE(req({}))
    expect(res.status).toBe(422)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not Pro', async () => {
    mockRun.mockResolvedValue({ ok: false, status: 403, message: 'This feature requires a Pro subscription.' })
    const res = await OPTIMIZE(req({ itemId: 'item-1' }))
    expect(res.status).toBe(403)
  })

  it('returns 429 with a Retry-After header when rate-limited', async () => {
    mockRun.mockResolvedValue({ ok: false, status: 429, message: 'slow down', retryAfter: 30 })
    const res = await OPTIMIZE(req({ itemId: 'item-1' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
  })

  it('returns 500 when the OpenAI client is unconfigured', async () => {
    mockRun.mockResolvedValue({ ok: false, status: 500, message: 'AI prompt optimization is not configured.' })
    const res = await OPTIMIZE(req({ itemId: 'item-1' }))
    expect(res.status).toBe(500)
  })

  it('returns 200 with the optimized prompt', async () => {
    mockRun.mockResolvedValue({ ok: true, value: { prompt: 'Act as a senior engineer.' } })
    const res = await OPTIMIZE(req({ itemId: 'item-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ prompt: 'Act as a senior engineer.' })
    // Pro userId from session is passed to the orchestration (IDOR-safe).
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', isPro: true }))
  })

  it('execute reads the item scoped to the session userId and yields null when content is empty', async () => {
    mockGetContext.mockResolvedValue({ itemType: 'prompt', content: null, language: null })
    const execute = await runOptimizeExecute({ itemId: 'item-1' })

    await expect(execute({}, { itemId: 'item-1' })).resolves.toBeNull()
    // IDOR-safe: the DB read is scoped to the session userId, not anything from the request body.
    expect(mockGetContext).toHaveBeenCalledWith('user-1', 'item-1')
    expect(mockCompletion).not.toHaveBeenCalled()
  })

  it('execute truncates content to the input cap before calling the model', async () => {
    const oversized = 'a'.repeat(OPTIMIZE_MAX_INPUT_CHARS + 500)
    mockGetContext.mockResolvedValue({ itemType: 'prompt', content: oversized, language: null })
    mockCompletion.mockResolvedValue({ prompt: 'done' })
    const execute = await runOptimizeExecute({ itemId: 'item-1' })

    await expect(execute({}, { itemId: 'item-1' })).resolves.toEqual({ prompt: 'done' })
    const userMessage = (mockCompletion.mock.calls[0][1] as { input: string }).input
    expect(userMessage).toContain('a'.repeat(OPTIMIZE_MAX_INPUT_CHARS))
    expect(userMessage).not.toContain('a'.repeat(OPTIMIZE_MAX_INPUT_CHARS + 1))
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

describe('GET /ai/usage', () => {
  function getReq(): NextRequest {
    return new NextRequest('http://localhost/api/ai/usage', { method: 'GET' })
  }

  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await USAGE(getReq())
    expect(res.status).toBe(401)
    expect(mockGetAiUsage).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not Pro (the route does its own gate, never reading usage)', async () => {
    mockIsPro.mockResolvedValue(false)
    const res = await USAGE(getReq())
    expect(res.status).toBe(403)
    expect(mockGetAiUsage).not.toHaveBeenCalled()
  })

  it('returns 200 with the per-feature usage + brain-dump quota, read for the session userId (IDOR-safe)', async () => {
    const features = [{ key: 'aiOptimize', limit: 20, remaining: 13, resetAt: 0 }]
    const brainDump = { key: 'aiBrainDump', limit: 1, remaining: 1, resetAt: 0 }
    mockGetAiUsage.mockResolvedValue(features)
    mockGetBrainDumpUsage.mockResolvedValue(brainDump)
    const res = await USAGE(getReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ features, brainDump })
    expect(mockGetAiUsage).toHaveBeenCalledWith('user-1')
    expect(mockGetBrainDumpUsage).toHaveBeenCalledWith('user-1')
  })
})
