import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import type { getOpenAIClient as GetOpenAIClientFn } from '@/lib/ai/openai'
import type { checkRateLimit as CheckRateLimitFn } from '@/lib/infra/rate-limit'
import type { getItemAiMetadata } from '@/lib/db/items'

vi.mock('@/lib/ai/openai', () => ({ getOpenAIClient: vi.fn<typeof GetOpenAIClientFn>() }))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn<typeof CheckRateLimitFn>(),
  deniedMessage: (retryAfter: number) => `slow down for ${retryAfter}s`,
}))
vi.mock('@/lib/db/items', () => ({ getItemAiMetadata: vi.fn<typeof getItemAiMetadata>() }))

import { getOpenAIClient } from '@/lib/ai/openai'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { runProAiGeneration, type RunProAiGenerationParams } from '@/lib/ai/description-generation'

const mockGetClient = vi.mocked(getOpenAIClient)
const mockCheckRateLimit = vi.mocked(checkRateLimit)

const log = {
  info: vi.fn<Logger['info']>(),
  warn: vi.fn<Logger['warn']>(),
  error: vi.fn<Logger['error']>(),
} as unknown as Logger

// A non-null sentinel standing in for the OpenAI client; the orchestration only checks truthiness
// and hands it to `execute`, which we stub per test.
const fakeClient = {} as Parameters<RunProAiGenerationParams<unknown, unknown>['execute']>[0]

type ExecuteFn = RunProAiGenerationParams<{ prompt: string }, string>['execute']

function buildParams(
  overrides: Partial<RunProAiGenerationParams<{ prompt: string }, string>> = {},
): RunProAiGenerationParams<{ prompt: string }, string> {
  return {
    isPro: true,
    userId: 'user-1',
    data: { prompt: 'hi' },
    rateLimitKey: 'aiDescription',
    notConfiguredMessage: 'AI is not configured.',
    failureMessage: 'Generation failed.',
    log,
    logLabel: 'description',
    execute: vi.fn<ExecuteFn>().mockResolvedValue('generated text'),
    ...overrides,
  }
}

describe('runProAiGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
    mockGetClient.mockReturnValue(fakeClient)
  })

  it('returns 403 for a non-Pro user without consuming rate-limit budget', async () => {
    const params = buildParams({ isPro: false })
    const result = await runProAiGeneration(params)

    expect(result).toEqual({ ok: false, status: 403, message: 'This feature requires a Pro subscription.' })
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(params.execute).not.toHaveBeenCalled()
  })

  it('returns 429 with retryAfter when rate-limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 30 })
    const params = buildParams()

    const result = await runProAiGeneration(params)

    expect(result).toEqual({ ok: false, status: 429, message: 'slow down for 30s', retryAfter: 30 })
    expect(mockGetClient).not.toHaveBeenCalled()
    expect(params.execute).not.toHaveBeenCalled()
  })

  it('returns 500 with notConfiguredMessage when the OpenAI client is unavailable', async () => {
    mockGetClient.mockReturnValue(null)
    const params = buildParams()

    const result = await runProAiGeneration(params)

    expect(result).toEqual({ ok: false, status: 500, message: 'AI is not configured.' })
    expect(params.execute).not.toHaveBeenCalled()
  })

  it('returns 500 with failureMessage when execute throws', async () => {
    const params = buildParams({ execute: vi.fn<ExecuteFn>().mockRejectedValue(new Error('OpenAI down')) })

    const result = await runProAiGeneration(params)

    expect(result).toEqual({ ok: false, status: 500, message: 'Generation failed.' })
  })

  it('returns 500 with failureMessage when execute yields null', async () => {
    const params = buildParams({ execute: vi.fn<ExecuteFn>().mockResolvedValue(null) })

    const result = await runProAiGeneration(params)

    expect(result).toEqual({ ok: false, status: 500, message: 'Generation failed.' })
  })

  it('returns the generated value on success', async () => {
    const execute = vi.fn<ExecuteFn>().mockResolvedValue('generated text')
    const params = buildParams({ execute })

    const result = await runProAiGeneration(params)

    expect(result).toEqual({ ok: true, value: 'generated text' })
    expect(execute).toHaveBeenCalledWith(fakeClient, { prompt: 'hi' })
  })
})
