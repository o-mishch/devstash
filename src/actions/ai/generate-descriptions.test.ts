import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateDescription, generateCollectionDescription } from './generate-descriptions'
import { createResponse, setupProAiMocks } from './ai-action-test-helpers'
import * as session from '@/lib/session'
import * as rateLimit from '@/lib/infra/rate-limit'
import { getOpenAIClient } from '@/lib/ai/openai'

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

describe('generateDescription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupProAiMocks()
  })

  it('fails if user is not pro', async () => {
    vi.mocked(session.withAuth).mockImplementation(async (fn) => {
      return fn({ userId: 'user1', isPro: false })
    })

    const result = await generateDescription({ itemType: 'snippet', title: 'React Hooks' })
    expect(result.status).toBe('forbidden')
    expect(rateLimit.rateLimitAction).not.toHaveBeenCalled()
  })

  it('fails validation without any context fields', async () => {
    const result = await generateDescription({ itemType: 'snippet' })
    expect(result.status).toBe('validation_error')
  })

  it('returns too_many_requests when the AI limit is exceeded for a pro user', async () => {
    vi.mocked(rateLimit.rateLimitAction).mockResolvedValue({
      status: 'too_many_requests',
      data: null,
      message: 'Too many attempts. Please try again in a moment.',
    })

    const result = await generateDescription({ itemType: 'snippet', title: 'React Hooks' })
    expect(result.status).toBe('too_many_requests')
    expect(createResponse).not.toHaveBeenCalled()
  })

  it('truncates long content instead of failing validation', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"description": "A long React snippet."}',
    })

    const longContent = 'x'.repeat(7000)
    const result = await generateDescription({
      itemType: 'snippet',
      title: 'Long snippet',
      content: longContent,
    })

    expect(result.status).toBe('ok')
    expect(createResponse).toHaveBeenCalledOnce()
    const call = createResponse.mock.calls[0][0]
    expect(call.input).toContain('x'.repeat(6000))
    expect(call.input).not.toContain('x'.repeat(6001))
  })

  it('successfully generates and parses a description', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"description": "A React hook for debouncing input values."}',
    })

    const result = await generateDescription({
      itemType: 'snippet',
      title: 'useDebounce',
      content: 'export function useDebounce() {}',
      language: 'typescript',
    })

    expect(result.status).toBe('ok')
    expect(result.data?.description).toBe('A React hook for debouncing input values.')
    expect(createResponse).toHaveBeenCalledOnce()
    const call = createResponse.mock.calls[0][0]
    expect(call.model).toBe('gpt-5-mini')
    expect(call.input).toContain('Item type: snippet')
    expect(call.input).toContain('Language: typescript')
  })

  it('accepts link context with URL only', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"description": "Documentation for the Next.js App Router."}',
    })

    const result = await generateDescription({
      itemType: 'link',
      title: 'Next.js docs',
      url: 'https://nextjs.org/docs',
    })

    expect(result.status).toBe('ok')
    expect(result.data?.description).toBe('Documentation for the Next.js App Router.')
  })

  it('accepts file context with file name', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"description": "Project architecture notes in PDF format."}',
    })

    const result = await generateDescription({
      itemType: 'file',
      title: 'Architecture',
      fileName: 'architecture.pdf',
    })

    expect(result.status).toBe('ok')
    expect(createResponse).toHaveBeenCalledOnce()
    const call = createResponse.mock.calls[0][0]
    expect(call.input).toContain('File name: architecture.pdf')
  })

  it('includes file metadata in the AI prompt', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"description": "A wide dashboard screenshot."}',
    })

    const result = await generateDescription({
      itemType: 'image',
      fileName: 'dashboard.png',
      fileSize: 1_048_576,
      imageWidth: 1920,
      imageHeight: 1080,
    })

    expect(result.status).toBe('ok')
    const call = createResponse.mock.calls[0][0]
    expect(call.input).toContain('File extension: png')
    expect(call.input).toContain('File size: 1.0 MB')
    expect(call.input).toContain('Image dimensions: 1920 × 1080 px')
  })

  it('handles parsing errors gracefully', async () => {
    createResponse.mockResolvedValue({
      output_text: '{ "notDescription": "nope" }',
    })

    const result = await generateDescription({ itemType: 'note', title: 'Meeting notes' })
    expect(result.status).toBe('internal_error')
  })

  it('handles plain string output format', async () => {
    createResponse.mockResolvedValue({
      output_text: 'A concise summary of the command.',
    })

    const result = await generateDescription({ itemType: 'command', title: 'Deploy script' })
    expect(result.status).toBe('ok')
    expect(result.data?.description).toBe('A concise summary of the command.')
  })

  it('calls rate limit with aiDescription key', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"description": "A short summary."}',
    })

    await generateDescription({ itemType: 'snippet', title: 'Test' })

    expect(rateLimit.rateLimitAction).toHaveBeenCalledWith('aiDescription', 'user1')
  })

  it('fails validation for invalid item type', async () => {
    const result = await generateDescription({ itemType: 'invalid', title: 'Test' })
    expect(result.status).toBe('validation_error')
  })

  it('accepts content without title', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"description": "A debounce hook for React inputs."}',
    })

    const result = await generateDescription({
      itemType: 'snippet',
      content: 'export function useDebounce() {}',
    })

    expect(result.status).toBe('ok')
    expect(result.data?.description).toBe('A debounce hook for React inputs.')
  })

  it('truncates descriptions longer than 280 characters', async () => {
    createResponse.mockResolvedValue({
      output_text: JSON.stringify({ description: 'a'.repeat(281) }),
    })

    const result = await generateDescription({ itemType: 'note', title: 'Notes' })
    expect(result.status).toBe('ok')
    expect(result.data?.description).toBe('a'.repeat(280))
  })

  it('handles empty OpenAI response', async () => {
    createResponse.mockResolvedValue({ output_text: '' })

    const result = await generateDescription({ itemType: 'prompt', title: 'Review' })
    expect(result.status).toBe('internal_error')
  })

  it('fails gracefully if OpenAI is not configured', async () => {
    vi.mocked(getOpenAIClient).mockReturnValue(null)

    const result = await generateDescription({ itemType: 'prompt', title: 'Code review' })
    expect(result.status).toBe('internal_error')
    expect(createResponse).not.toHaveBeenCalled()
  })

  it('handles OpenAI API errors gracefully', async () => {
    createResponse.mockRejectedValue(new Error('OpenAI unavailable'))

    const result = await generateDescription({ itemType: 'snippet', title: 'Test' })
    expect(result.status).toBe('internal_error')
  })
})

describe('generateCollectionDescription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupProAiMocks()
  })

  it('fails if user is not pro', async () => {
    vi.mocked(session.withAuth).mockImplementation(async (fn) => {
      return fn({ userId: 'user1', isPro: false })
    })

    const result = await generateCollectionDescription({ name: 'React Patterns' })
    expect(result.status).toBe('forbidden')
    expect(rateLimit.rateLimitAction).not.toHaveBeenCalled()
  })

  it('fails validation without a name', async () => {
    const result = await generateCollectionDescription({ name: '   ' })
    expect(result.status).toBe('validation_error')
  })

  it('calls rate limit with aiDescription key', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"description": "React snippets and patterns."}',
    })

    await generateCollectionDescription({ name: 'React Patterns' })

    expect(rateLimit.rateLimitAction).toHaveBeenCalledWith('aiDescription', 'user1')
  })

  it('returns too_many_requests when the AI limit is exceeded for a pro user', async () => {
    vi.mocked(rateLimit.rateLimitAction).mockResolvedValue({
      status: 'too_many_requests',
      data: null,
      message: 'Too many attempts. Please try again in a moment.',
    })

    const result = await generateCollectionDescription({ name: 'React Patterns' })
    expect(result.status).toBe('too_many_requests')
    expect(createResponse).not.toHaveBeenCalled()
  })

  it('successfully generates and parses a description', async () => {
    createResponse.mockResolvedValue({
      output_text: '{"description": "Snippets and patterns for React hooks."}',
    })

    const result = await generateCollectionDescription({ name: 'React Patterns' })

    expect(result.status).toBe('ok')
    expect(result.data?.description).toBe('Snippets and patterns for React hooks.')
    expect(createResponse).toHaveBeenCalledOnce()
    const call = createResponse.mock.calls[0][0]
    expect(call.model).toBe('gpt-5-mini')
    expect(call.input).toContain('Collection name: React Patterns')
  })

  it('handles parsing errors gracefully', async () => {
    createResponse.mockResolvedValue({
      output_text: '{ "notDescription": "nope" }',
    })

    const result = await generateCollectionDescription({ name: 'Go Utilities' })
    expect(result.status).toBe('internal_error')
  })

  it('truncates descriptions longer than 500 characters', async () => {
    createResponse.mockResolvedValue({
      output_text: JSON.stringify({ description: 'a'.repeat(501) }),
    })

    const result = await generateCollectionDescription({ name: 'DevOps' })
    expect(result.status).toBe('ok')
    expect(result.data?.description).toBe('a'.repeat(500))
  })

  it('handles empty OpenAI response', async () => {
    createResponse.mockResolvedValue({ output_text: '' })

    const result = await generateCollectionDescription({ name: 'DevOps' })
    expect(result.status).toBe('internal_error')
  })

  it('handles OpenAI API errors gracefully', async () => {
    createResponse.mockRejectedValue(new Error('OpenAI unavailable'))

    const result = await generateCollectionDescription({ name: 'DevOps' })
    expect(result.status).toBe('internal_error')
  })

  it('fails gracefully if OpenAI is not configured', async () => {
    vi.mocked(getOpenAIClient).mockReturnValue(null)

    const result = await generateCollectionDescription({ name: 'DevOps' })
    expect(result.status).toBe('internal_error')
    expect(createResponse).not.toHaveBeenCalled()
  })
})
