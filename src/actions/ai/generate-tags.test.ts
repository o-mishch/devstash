import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateAutoTags } from './generate-tags'
import { createResponse, setupProAiMocks } from './ai-action-test-helpers'
import * as session from '@/lib/session'
import * as rateLimit from '@/lib/infra/rate-limit'
import { getOpenAIClient } from '@/lib/ai/openai'

vi.mock('@/lib/db/items', () => ({
  getItemAiMetadata: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/ai/openai', () => ({
  getOpenAIClient: vi.fn(),
  AI_MODELS: { TAG: 'gpt-4.1-nano', DEFAULT: 'gpt-5-mini' },
}))

vi.mock('@/lib/session', () => ({
  withAuth: vi.fn(),
}))

vi.mock('@/lib/infra/rate-limit', () => ({
  rateLimitAction: vi.fn(),
}))

describe('generateAutoTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupProAiMocks()
  })

  it('fails if user is not pro', async () => {
    vi.mocked(session.withAuth).mockImplementation(async (fn) => {
      return fn({ userId: 'user1', isPro: false })
    })

    const result = await generateAutoTags({ itemType: 'snippet', title: 'React Hooks' })
    expect(result.status).toBe('forbidden')
    expect(rateLimit.rateLimitAction).not.toHaveBeenCalled()
  })

  it('fails validation without title or file name', async () => {
    const result = await generateAutoTags({ itemType: 'snippet', content: 'test' })
    expect(result.status).toBe('validation_error')
  })

  it('returns too_many_requests when the AI limit is exceeded for a pro user', async () => {
    vi.mocked(rateLimit.rateLimitAction).mockResolvedValue({
      status: 'too_many_requests',
      data: null,
      message: 'Too many attempts. Please try again in a moment.',
    })

    const result = await generateAutoTags({ itemType: 'snippet', title: 'React Hooks' })
    expect(result.status).toBe('too_many_requests')
    expect(createResponse).not.toHaveBeenCalled()
  })

  it('truncates long content instead of failing validation', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"tags": ["typescript"]}',
    })

    const longContent = 'x'.repeat(5000)
    const result = await generateAutoTags({
      itemType: 'snippet',
      title: 'Long snippet',
      content: longContent,
    })

    expect(result.status).toBe('ok')
    expect(createResponse).toHaveBeenCalledOnce()
    const call = createResponse.mock.calls[0][0]
    expect(call.input).toContain('x'.repeat(4000))
    expect(call.input).not.toContain('x'.repeat(4001))
  })

  it('successfully generates and parses tags', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"tags": ["react", "typescript"]}'
    })

    const result = await generateAutoTags({
      itemType: 'snippet',
      title: 'React Hooks',
      content: 'Use hooks in React',
    })
    expect(result.status).toBe('ok')
    expect(result.data).toEqual(['react', 'typescript'])
    expect(createResponse).toHaveBeenCalledOnce()
    const call = createResponse.mock.calls[0][0]
    expect(call.input).toContain('Item type: snippet')
  })

  it('accepts file name context and allows file name without title', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"tags": ["pdf", "architecture"]}',
    })

    const result = await generateAutoTags({
      itemType: 'file',
      fileName: 'architecture.pdf',
    })

    expect(result.status).toBe('ok')
    expect(createResponse).toHaveBeenCalledOnce()
    const call = createResponse.mock.calls[0][0]
    expect(call.input).toContain('Item type: file')
    expect(call.input).toContain('File name: architecture.pdf')
    expect(call.input).not.toContain('Title:')
  })

  it('includes file metadata and stored dimensions in the AI prompt', async () => {
    const { getItemAiMetadata } = await import('@/lib/db/items')
    vi.mocked(getItemAiMetadata).mockResolvedValueOnce({ imageWidth: 1280, imageHeight: 720 })

    createResponse.mockResolvedValue({
      output_text: '{"tags": ["screenshot", "ui"]}',
    })

    const result = await generateAutoTags({
      itemType: 'image',
      itemId: 'item-123',
      fileName: 'dashboard.png',
      fileSize: 512_000,
    })

    expect(result.status).toBe('ok')
    const call = createResponse.mock.calls[0][0]
    expect(call.input).toContain('File extension: png')
    expect(call.input).toContain('File size: 500.0 KB')
    expect(call.input).toContain('Image dimensions: 1280 × 720 px')
  })

  it('handles parsing errors gracefully', async () => {
    createResponse.mockResolvedValue({
      output_text: 'invalid json'
    })

    const result = await generateAutoTags({ itemType: 'snippet', title: 'JS' })
    expect(result.status).toBe('internal_error')
  })

  it('handles array output format', async () => {
    createResponse.mockResolvedValue({
      output_text: '["javascript", "frontend"]'
    })

    const result = await generateAutoTags({ itemType: 'snippet', title: 'JS' })
    expect(result.status).toBe('ok')
    expect(result.data).toEqual(['javascript', 'frontend'])
  })

  it('fails gracefully if OpenAI is not configured', async () => {
    vi.mocked(getOpenAIClient).mockReturnValue(null)

    const result = await generateAutoTags({ itemType: 'snippet', title: 'JS' })
    expect(result.status).toBe('internal_error')
    expect(createResponse).not.toHaveBeenCalled()
  })
})
