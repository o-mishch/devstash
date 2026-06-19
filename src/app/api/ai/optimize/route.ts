import { authedRoute } from '@/lib/api/route'
import { json, problemFrom, parseOr422 } from '@/lib/api/http'
import { optimizePromptInput } from '@/lib/api/schemas/ai'
import { runProAiGeneration, runOpenAiCompletion } from '@/lib/ai/description-generation'
import { AI_MODELS } from '@/lib/ai/openai'
import { PROMPT_OPTIMIZATION_SYSTEM_PROMPT, parseAiOptimizedPromptResponse } from '@/lib/ai/optimize-response'
import { buildItemAiUserMessage } from '@/lib/ai/item-context'
import { getItemExplainContext } from '@/lib/db/items'
import { OPTIMIZE_MAX_INPUT_CHARS } from '@/lib/utils/constants'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-optimize' })

export const POST = authedRoute({}, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(optimizePromptInput, await request.json())
  if (!parsed.ok) return parsed.res

  const result = await runProAiGeneration({
    isPro,
    userId,
    data: { itemId: parsed.data.itemId },
    rateLimitKey: 'aiOptimize',
    notConfiguredMessage: 'AI prompt optimization is not configured.',
    failureMessage: 'Failed to optimize prompt.',
    log,
    logLabel: 'AI prompt optimization',
    // Read the item content inside execute — only after the Pro gate + rate limit pass — and scoped
    // to the session userId (IDOR-safe). A missing item or empty content yields null → 500.
    execute: async (client, data) => {
      const item = await getItemExplainContext(userId, data.itemId)
      if (!item?.content) return null
      return runOpenAiCompletion(
        client,
        {
          model: AI_MODELS.DEFAULT,
          instructions: PROMPT_OPTIMIZATION_SYSTEM_PROMPT,
          input: buildItemAiUserMessage({
            itemType: item.itemType,
            content: item.content.slice(0, OPTIMIZE_MAX_INPUT_CHARS),
          }),
        },
        (responseContent) => {
          const prompt = parseAiOptimizedPromptResponse(responseContent)
          return prompt ? { prompt } : null
        },
        log,
      )
    },
  })

  if (!result.ok) return problemFrom(result)
  return json(result.value)
})
