import 'server-only'
import { z } from 'zod'
import { authenticatedRoute } from '@/lib/api'
import { parseOrFail } from '@/lib/utils/validators'
import { runProAiGeneration, runOpenAiCompletion, resolveItemImageDimensions } from '@/lib/ai/description-generation'
import { AI_MODELS } from '@/lib/ai/openai'
import {
  ITEM_MAX_DESCRIPTION_CHARS,
  ITEM_DESCRIPTION_SYSTEM_PROMPT,
  parseAiDescriptionResponse,
} from '@/lib/ai/description-response'
import { createLogger } from '@/lib/infra/logger'
import {
  buildItemAiUserMessage,
  itemTypeSchema,
  itemAiFileMetadataSchema,
  trimOptionalAiField,
} from '@/lib/ai/item-context'

const log = createLogger('ai-description')

const MAX_AI_INPUT_CHARS = 6000

const generateDescriptionSchema = z
  .object({
    itemType: itemTypeSchema,
    itemId: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    url: z.string().optional(),
    language: z.string().optional(),
    fileName: z.string().optional(),
    ...itemAiFileMetadataSchema,
  })
  .transform((data) => ({
    itemType: data.itemType,
    itemId: data.itemId,
    title: trimOptionalAiField(data.title, MAX_AI_INPUT_CHARS),
    content: trimOptionalAiField(data.content, MAX_AI_INPUT_CHARS),
    url: trimOptionalAiField(data.url, MAX_AI_INPUT_CHARS),
    language: trimOptionalAiField(data.language, 100),
    fileName: trimOptionalAiField(data.fileName, 255),
    fileSize: data.fileSize,
  }))
  .refine(
    (data) => Boolean(data.title || data.content || data.url || data.fileName),
    { message: 'Provide a title, content, URL, or file name to generate a description.' }
  )

export const POST = authenticatedRoute(async (request, _context, { userId, isPro }) => {
  const body: unknown = await request.json()
  const parseResult = parseOrFail(generateDescriptionSchema, body)

  return runProAiGeneration({
    isPro,
    userId,
    parseResult,
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
})
