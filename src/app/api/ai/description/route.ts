import { authedRoute } from '@/lib/api/route'
import { json, problemFrom, parseOr422 } from '@/lib/api/http'
import { generateDescriptionInput } from '@/lib/api/schemas/ai'
import { runProAiGeneration, runOpenAiCompletion, resolveItemImageDimensions } from '@/lib/ai/description-generation'
import { AI_MODELS } from '@/lib/ai/openai'
import {
  ITEM_MAX_DESCRIPTION_CHARS,
  ITEM_DESCRIPTION_SYSTEM_PROMPT,
  parseAiDescriptionResponse,
} from '@/lib/ai/description-response'
import { buildItemAiUserMessage } from '@/lib/ai/item-context'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-description' })

export const POST = authedRoute({}, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(generateDescriptionInput, await request.json())
  if (!parsed.ok) return parsed.res

  const result = await runProAiGeneration({
    isPro,
    userId,
    data: parsed.data,
    rateLimitKey: 'aiDescription',
    notConfiguredMessage: 'AI description generation is not configured.',
    failureMessage: 'Failed to generate description.',
    log,
    logLabel: 'AI item description',
    execute: async (client, data) => {
      const { imageWidth, imageHeight } = await resolveItemImageDimensions(userId, data)
      return runOpenAiCompletion(
        client,
        {
          model: AI_MODELS.DEFAULT,
          instructions: ITEM_DESCRIPTION_SYSTEM_PROMPT,
          input: buildItemAiUserMessage({ ...data, imageWidth, imageHeight }),
        },
        (responseContent) => {
          const description = parseAiDescriptionResponse(responseContent, ITEM_MAX_DESCRIPTION_CHARS)
          return description ? { description } : null
        },
        log,
      )
    },
  })

  if (!result.ok) return problemFrom(result)
  return json(result.value)
})
