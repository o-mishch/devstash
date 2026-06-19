import { authedRoute } from '@/lib/api/route'
import { json, problemFrom, parseOr422 } from '@/lib/api/http'
import { explainCodeInput } from '@/lib/api/schemas/ai'
import { runProAiGeneration, runOpenAiCompletion } from '@/lib/ai/description-generation'
import { AI_MODELS } from '@/lib/ai/openai'
import { CODE_EXPLANATION_SYSTEM_PROMPT, parseAiExplanationResponse } from '@/lib/ai/explain-response'
import { buildItemAiUserMessage } from '@/lib/ai/item-context'
import { getItemExplainContext } from '@/lib/db/items'
import { EXPLAIN_MAX_INPUT_CHARS } from '@/lib/utils/constants'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-explain' })

export const POST = authedRoute({}, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(explainCodeInput, await request.json())
  if (!parsed.ok) return parsed.res

  const result = await runProAiGeneration({
    isPro,
    userId,
    data: { itemId: parsed.data.itemId },
    rateLimitKey: 'aiExplain',
    notConfiguredMessage: 'AI code explanation is not configured.',
    failureMessage: 'Failed to explain code.',
    log,
    logLabel: 'AI code explanation',
    // Read the item content inside execute — only after the Pro gate + rate limit pass — and scoped
    // to the session userId (IDOR-safe). A missing item or empty content yields null → 500.
    execute: async (client, data) => {
      const item = await getItemExplainContext(userId, data.itemId)
      if (!item?.content) return null
      return runOpenAiCompletion(
        client,
        {
          model: AI_MODELS.DEFAULT,
          instructions: CODE_EXPLANATION_SYSTEM_PROMPT,
          input: buildItemAiUserMessage({
            itemType: item.itemType,
            content: item.content.slice(0, EXPLAIN_MAX_INPUT_CHARS),
            language: item.language ?? undefined,
          }),
        },
        (responseContent) => {
          const explanation = parseAiExplanationResponse(responseContent)
          return explanation ? { explanation } : null
        },
        log,
      )
    },
  })

  if (!result.ok) return problemFrom(result)
  return json(result.value)
})
