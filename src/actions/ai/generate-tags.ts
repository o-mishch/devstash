'use server'

import { z } from 'zod'
import { withAuth } from '@/lib/session'
import { parseOrFail } from '@/lib/utils/validators'
import { AI_MODELS } from '@/lib/ai/openai'
import { runProAiGeneration } from '@/lib/ai/description-generation'
import { createLogger } from '@/lib/infra/logger'
import {
  buildItemAiUserMessage,
  itemTypeSchema,
  itemAiFileMetadataSchema,
  trimOptionalAiField,
} from '@/lib/ai/item-context'
import type { ApiBody } from '@/types/api'

const log = createLogger('generate-tags')

const MAX_AI_INPUT_CHARS = 4000

const generateTagsSchema = z
  .object({
    itemType: itemTypeSchema,
    title: z.string().optional(),
    content: z.string().optional(),
    fileName: z.string().optional(),
    ...itemAiFileMetadataSchema,
  })
  .transform((data) => ({
    itemType: data.itemType,
    title: trimOptionalAiField(data.title, MAX_AI_INPUT_CHARS),
    content: trimOptionalAiField(data.content, MAX_AI_INPUT_CHARS),
    fileName: trimOptionalAiField(data.fileName, 255),
    fileSize: data.fileSize,
    imageWidth: data.imageWidth,
    imageHeight: data.imageHeight,
  }))
  .refine(
    (data) => Boolean(data.title || data.fileName),
    { message: 'Provide a title or file name to suggest tags.' }
  )

export type GenerateTagsInput = z.infer<typeof generateTagsSchema>

const tagSchema = z.string().trim().min(1).max(50)
const tagResponseSchema = z.union([
  z.object({ tags: z.array(tagSchema).max(5) }),
  z.array(tagSchema).max(5),
])

const TAG_SYSTEM_PROMPT = `You are an expert tag generator for a developer knowledge base.
Your task is to suggest 3-5 highly relevant, concise, and specific tags based on the provided item type, title, file name, and content.
Return the result strictly as a JSON object with a single "tags" property containing an array of strings.
Example: { "tags": ["react", "hooks", "typescript"] }
Do not include any other text or properties.`

function parseTagsResponse(responseContent: string): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseContent)
  } catch {
    return null
  }

  const result = tagResponseSchema.safeParse(parsed)
  if (!result.success) return null

  const tags = Array.isArray(result.data) ? result.data : result.data.tags
  return [...new Set(tags.map((tag) => tag.toLowerCase()))].slice(0, 5)
}

export async function generateAutoTags(
  rawInput: unknown
): Promise<ApiBody<string[] | null>> {
  return withAuth<string[] | null>(async ({ isPro, userId }) => {
    const parseResult = parseOrFail(generateTagsSchema, rawInput)

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
        const completion = await client.responses.create({
          model: AI_MODELS.TAG,
          instructions: TAG_SYSTEM_PROMPT,
          input: buildItemAiUserMessage(data),
        })

        const responseContent = completion.output_text
        if (!responseContent) {
          throw new Error('No content returned from OpenAI')
        }

        const normalizedTags = parseTagsResponse(responseContent)
        if (!normalizedTags) {
          log.error('Failed to parse OpenAI JSON response', {
            responseLength: responseContent.length,
          })
          return null
        }

        return normalizedTags
      },
    })
  }, 'generateAutoTags')
}
