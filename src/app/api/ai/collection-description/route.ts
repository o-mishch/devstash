import 'server-only'
import { z } from 'zod'
import { authenticatedRoute } from '@/lib/api'
import { parseOrFail } from '@/lib/utils/validators'
import { runProAiGeneration, runOpenAiCompletion } from '@/lib/ai/description-generation'
import { AI_MODELS } from '@/lib/ai/openai'
import {
  COLLECTION_MAX_DESCRIPTION_CHARS,
  COLLECTION_DESCRIPTION_SYSTEM_PROMPT,
  parseAiDescriptionResponse,
} from '@/lib/ai/description-response'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('ai-collection-description')

const MAX_NAME_CHARS = 100

const generateCollectionDescriptionSchema = z
  .object({
    name: z.string(),
  })
  .transform((data) => ({
    name: data.name.trim().slice(0, MAX_NAME_CHARS),
  }))
  .refine((data) => data.name.length > 0, { message: 'Collection name is required' })

export const POST = authenticatedRoute(async (request, _context, { userId, isPro }) => {
  const body: unknown = await request.json()
  const parseResult = parseOrFail(generateCollectionDescriptionSchema, body)

  return runProAiGeneration({
    isPro,
    userId,
    parseResult,
    rateLimitKey: 'aiDescription',
    notConfiguredMessage: 'AI description generation is not configured.',
    failureMessage: 'Failed to generate description.',
    log,
    logLabel: 'AI collection description',
    execute: async (client, data) =>
      runOpenAiCompletion(
        client,
        {
          model: AI_MODELS.DEFAULT,
          instructions: COLLECTION_DESCRIPTION_SYSTEM_PROMPT,
          input: `Collection name: ${data.name}`,
        },
        (responseContent) => {
          const description = parseAiDescriptionResponse(responseContent, COLLECTION_MAX_DESCRIPTION_CHARS)
          return description ? { description } : null
        },
        log,
      ),
  })
})
