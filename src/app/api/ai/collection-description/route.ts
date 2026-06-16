import { authedRoute } from '@/lib/api/route'
import { json, problemFrom, parseOr422 } from '@/lib/api/http'
import { generateCollectionDescriptionInput } from '@/lib/api/schemas/ai'
import { runProAiGeneration, runOpenAiCompletion } from '@/lib/ai/description-generation'
import { AI_MODELS } from '@/lib/ai/openai'
import {
  COLLECTION_MAX_DESCRIPTION_CHARS,
  COLLECTION_DESCRIPTION_SYSTEM_PROMPT,
  parseAiDescriptionResponse,
} from '@/lib/ai/description-response'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-collection-description' })

export const POST = authedRoute({}, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(generateCollectionDescriptionInput, await request.json())
  if (!parsed.ok) return parsed.res

  const result = await runProAiGeneration({
    isPro,
    userId,
    data: parsed.data,
    rateLimitKey: 'aiDescription',
    notConfiguredMessage: 'AI description generation is not configured.',
    failureMessage: 'Failed to generate description.',
    log,
    logLabel: 'AI collection description',
    execute: (client, data) =>
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

  if (!result.ok) return problemFrom(result)
  return json(result.value)
})
