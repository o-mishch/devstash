import 'server-only'
import { authed } from '../orpc'
import { runProAiGeneration, runOpenAiCompletion, resolveItemImageDimensions } from '@/lib/ai/description-generation'
import { AI_MODELS } from '@/lib/ai/openai'
import {
  ITEM_MAX_DESCRIPTION_CHARS,
  ITEM_DESCRIPTION_SYSTEM_PROMPT,
  COLLECTION_MAX_DESCRIPTION_CHARS,
  COLLECTION_DESCRIPTION_SYSTEM_PROMPT,
  parseAiDescriptionResponse,
} from '@/lib/ai/description-response'
import { TAG_SYSTEM_PROMPT, parseTagsResponse } from '@/lib/ai/tag-response'
import { buildItemAiUserMessage } from '@/lib/ai/item-context'
import { logger } from '@/lib/infra/pino'

const descriptionLog = logger.child({ tag: 'ai-description' })
const tagsLog = logger.child({ tag: 'ai-tags' })
const collectionDescriptionLog = logger.child({ tag: 'ai-collection-description' })

export const aiRouter = {
  generateDescription: authed.ai.generateDescription.handler(({ input, context }) =>
    runProAiGeneration({
      isPro: context.isPro,
      userId: context.userId,
      data: input,
      rateLimitKey: 'aiDescription',
      notConfiguredMessage: 'AI description generation is not configured.',
      failureMessage: 'Failed to generate description.',
      log: descriptionLog,
      logLabel: 'AI item description',
      execute: async (client, data) => {
        const { imageWidth, imageHeight } = await resolveItemImageDimensions(context.userId, data)
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
          descriptionLog,
        )
      },
    }),
  ),

  generateTags: authed.ai.generateTags.handler(({ input, context }) =>
    runProAiGeneration({
      isPro: context.isPro,
      userId: context.userId,
      data: input,
      rateLimitKey: 'aiTags',
      notConfiguredMessage: 'AI tag generation is not configured.',
      failureMessage: 'Failed to generate tags.',
      log: tagsLog,
      logLabel: 'AI tags',
      execute: async (client, data) => {
        const { imageWidth, imageHeight } = await resolveItemImageDimensions(context.userId, data)
        return runOpenAiCompletion(
          client,
          {
            model: AI_MODELS.TAG,
            instructions: TAG_SYSTEM_PROMPT,
            input: buildItemAiUserMessage({ ...data, imageWidth, imageHeight }),
          },
          parseTagsResponse,
          tagsLog,
        )
      },
    }),
  ),

  generateCollectionDescription: authed.ai.generateCollectionDescription.handler(({ input, context }) =>
    runProAiGeneration({
      isPro: context.isPro,
      userId: context.userId,
      data: input,
      rateLimitKey: 'aiDescription',
      notConfiguredMessage: 'AI description generation is not configured.',
      failureMessage: 'Failed to generate description.',
      log: collectionDescriptionLog,
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
          collectionDescriptionLog,
        ),
    }),
  ),
}
