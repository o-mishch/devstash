import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateAutoTags } from './generate-tags'
import { getOpenAIClient } from '@/lib/ai/openai'
import * as session from '@/lib/session'
import * as rateLimit from '@/lib/rate-limit'

const createResponse = vi.fn()

vi.mock('@/lib/ai/openai', () => ({
  getOpenAIClient: vi.fn(),
  AI_MODELS: { TAG: 'gpt-4.1-nano', DEFAULT: 'gpt-5-mini' },
}))

vi.mock('@/lib/session', () => ({
  withAuth: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimitAction: vi.fn(),
}))

describe('generateAutoTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(session.withAuth).mockImplementation(async (fn) => {
      return fn({ userId: 'user1', isPro: true })
    })
    vi.mocked(rateLimit.rateLimitAction).mockResolvedValue(null)
    vi.mocked(getOpenAIClient).mockReturnValue({
      responses: {
        create: createResponse,
      },
    } as ReturnType<typeof getOpenAIClient>)
  })

  it('fails if user is not pro', async () => {
    vi.mocked(session.withAuth).mockImplementation(async (fn) => {
      return fn({ userId: 'user1', isPro: false })
    })

    const result = await generateAutoTags({ title: 'React Hooks' })
    expect(result.status).toBe('forbidden')
    expect(rateLimit.rateLimitAction).not.toHaveBeenCalled()
  })

  it('fails validation without title', async () => {
    const result = await generateAutoTags({ content: 'test' })
    expect(result.status).toBe('validation_error')
  })

  it('returns too_many_requests when the AI limit is exceeded for a pro user', async () => {
    vi.mocked(rateLimit.rateLimitAction).mockResolvedValue({
      status: 'too_many_requests',
      data: null,
      message: 'Too many attempts. Please try again in a moment.',
    })

    const result = await generateAutoTags({ title: 'React Hooks' })
    expect(result.status).toBe('too_many_requests')
    expect(createResponse).not.toHaveBeenCalled()
  })

  it('successfully generates and parses tags', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"tags": ["react", "typescript"]}'
    })

    const result = await generateAutoTags({ title: 'React Hooks', content: 'Use hooks in React' })
    expect(result.status).toBe('ok')
    expect(result.data).toEqual(['react', 'typescript'])
    expect(createResponse).toHaveBeenCalledOnce()
  })

  it('handles parsing errors gracefully', async () => {
    createResponse.mockResolvedValue({
      output_text: 'invalid json'
    })

    const result = await generateAutoTags({ title: 'JS' })
    expect(result.status).toBe('internal_error')
  })

  it('handles array output format', async () => {
    createResponse.mockResolvedValue({
      output_text: '["javascript", "frontend"]'
    })

    const result = await generateAutoTags({ title: 'JS' })
    expect(result.status).toBe('ok')
    expect(result.data).toEqual(['javascript', 'frontend'])
  })

  it('fails gracefully if OpenAI is not configured', async () => {
    vi.mocked(getOpenAIClient).mockReturnValue(null)

    const result = await generateAutoTags({ title: 'JS' })
    expect(result.status).toBe('internal_error')
    expect(createResponse).not.toHaveBeenCalled()
  })
})
