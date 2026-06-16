import { authedRoute } from '@/lib/api/route'
import { json, problemFrom, parseOr422 } from '@/lib/api/http'
import { generateTagsInput } from '@/lib/api/schemas/ai'
import { runProAiGeneration, runOpenAiCompletion, resolveItemImageDimensions } from '@/lib/ai/description-generation'
import { AI_MODELS } from '@/lib/ai/openai'
import { TAG_SYSTEM_PROMPT, parseTagsResponse } from '@/lib/ai/tag-response'
import { buildItemAiUserMessage } from '@/lib/ai/item-context'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-tags' })

export const POST = authedRoute({}, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(generateTagsInput, await request.json())
  if (!parsed.ok) return parsed.res

  const result = await runProAiGeneration({
    isPro,
    userId,
    data: parsed.data,
    rateLimitKey: 'aiTags',
    notConfiguredMessage: 'AI tag generation is not configured.',
    failureMessage: 'Failed to generate tags.',
    log,
    logLabel: 'AI tags',
    execute: async (client, data) => {
      const { imageWidth, imageHeight } = await resolveItemImageDimensions(userId, data)
      return runOpenAiCompletion(
        client,
        {
          model: AI_MODELS.TAG,
          instructions: TAG_SYSTEM_PROMPT,
          input: buildItemAiUserMessage({ ...data, imageWidth, imageHeight }),
        },
        parseTagsResponse,
        log,
      )
    },
  })

  if (!result.ok) return problemFrom(result)
  return json(result.value)
})
