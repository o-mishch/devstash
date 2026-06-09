import { vi } from 'vitest'
import { getOpenAIClient } from '@/lib/ai/openai'
import * as session from '@/lib/session'
import * as rateLimit from '@/lib/infra/rate-limit'

export const createResponse = vi.fn()

export function setupProAiMocks(): void {
  vi.mocked(session.withAuth).mockImplementation(async (fn) => {
    return fn({ userId: 'user1', isPro: true })
  })
  vi.mocked(rateLimit.rateLimitAction).mockResolvedValue(null)
  vi.mocked(getOpenAIClient).mockReturnValue({
    responses: { create: createResponse },
  } as unknown as NonNullable<ReturnType<typeof getOpenAIClient>>)
}
