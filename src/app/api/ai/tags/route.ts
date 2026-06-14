import 'server-only'
import { z } from 'zod'
import { authenticatedRoute } from '@/lib/api'
import { parseOrFail } from '@/lib/utils/validators'
import { runProAiGeneration, runOpenAiCompletion, resolveItemImageDimensions } from '@/lib/ai/description-generation'
import { TAG_SYSTEM_PROMPT, parseTagsResponse } from '@/lib/ai/tag-response'
import { createLogger } from '@/lib/infra/logger'
import { AI_MODELS } from '@/lib/ai/openai'
import {
  buildItemAiUserMessage,
  itemTypeSchema,
  itemAiFileMetadataSchema,
  trimOptionalAiField,
} from '@/lib/ai/item-context'

const log = createLogger('ai-tags')

const MAX_AI_INPUT_CHARS = 4000

const generateTagsSchema = z
  .object({
    itemType: itemTypeSchema,
    itemId: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    fileName: z.string().optional(),
    ...itemAiFileMetadataSchema,
  })
  .transform((data) => ({
    itemType: data.itemType,
    itemId: data.itemId,
    title: trimOptionalAiField(data.title, MAX_AI_INPUT_CHARS),
    content: trimOptionalAiField(data.content, MAX_AI_INPUT_CHARS),
    fileName: trimOptionalAiField(data.fileName, 255),
    fileSize: data.fileSize,
  }))
  .refine(
    (data) => Boolean(data.title || data.fileName),
    { message: 'Provide a title or file name to suggest tags.' }
  )

export const POST = authenticatedRoute(async (request, _context, { userId, isPro }) => {
  const body: unknown = await request.json()
  const parseResult = parseOrFail(generateTagsSchema, body)

  return runProAiGeneration({
    isPro,
    userId,
    parseResult,
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
})
