'use server'

import type OpenAI from 'openai'
import { z } from 'zod'
import { withAuth } from '@/lib/session'
import { parseOrFail } from '@/lib/utils/validators'
import { AI_MODELS } from '@/lib/ai/openai'
import { runProAiGeneration } from '@/lib/ai/description-generation'
import {
  ITEM_MAX_DESCRIPTION_CHARS,
  COLLECTION_MAX_DESCRIPTION_CHARS,
  ITEM_DESCRIPTION_SYSTEM_PROMPT,
  COLLECTION_DESCRIPTION_SYSTEM_PROMPT,
  parseAiDescriptionResponse,
} from '@/lib/ai/description-response'
import { createLogger } from '@/lib/infra/logger'
import {
  buildItemAiUserMessage,
  itemTypeSchema,
  itemAiFileMetadataSchema,
  trimOptionalAiField,
} from '@/lib/ai/item-context'
import type { ApiBody } from '@/types/api'

const itemLog = createLogger('generate-description')
const collectionLog = createLogger('generate-collection-description')

const MAX_AI_INPUT_CHARS = 6000
const MAX_NAME_CHARS = 100

const generateDescriptionSchema = z
  .object({
    itemType: itemTypeSchema,
    title: z.string().optional(),
    content: z.string().optional(),
    url: z.string().optional(),
    language: z.string().optional(),
    fileName: z.string().optional(),
    ...itemAiFileMetadataSchema,
  })
  .transform((data) => ({
    itemType: data.itemType,
    title: trimOptionalAiField(data.title, MAX_AI_INPUT_CHARS),
    content: trimOptionalAiField(data.content, MAX_AI_INPUT_CHARS),
    url: trimOptionalAiField(data.url, MAX_AI_INPUT_CHARS),
    language: trimOptionalAiField(data.language, 100),
    fileName: trimOptionalAiField(data.fileName, 255),
    fileSize: data.fileSize,
    imageWidth: data.imageWidth,
    imageHeight: data.imageHeight,
  }))
  .refine(
    (data) => Boolean(data.title || data.content || data.url || data.fileName),
    { message: 'Provide a title, content, URL, or file name to generate a description.' }
  )

const generateCollectionDescriptionSchema = z
  .object({
    name: z.string(),
  })
  .transform((data) => ({
    name: data.name.trim().slice(0, MAX_NAME_CHARS),
  }))
  .refine((data) => data.name.length > 0, { message: 'Collection name is required' })

export type GenerateDescriptionInput = z.infer<typeof generateDescriptionSchema>
export type GenerateCollectionDescriptionInput = z.infer<typeof generateCollectionDescriptionSchema>

async function requestDescription(
  client: OpenAI,
  systemPrompt: string,
  userMessage: string,
  maxChars: number,
  log: ReturnType<typeof createLogger>,
  logContext?: Record<string, unknown>
): Promise<{ description: string } | null> {
  const completion = await client.responses.create({
    model: AI_MODELS.DEFAULT,
    instructions: systemPrompt,
    input: userMessage,
  })

  const responseContent = completion.output_text
  if (!responseContent) {
    throw new Error('No content returned from OpenAI')
  }

  const description = parseAiDescriptionResponse(responseContent, maxChars)
  if (!description) {
    log.error('Failed to parse OpenAI JSON response', {
      ...logContext,
      responseLength: responseContent.length,
    })
    return null
  }

  return { description }
}

export async function generateDescription(
  rawInput: unknown
): Promise<ApiBody<{ description: string } | null>> {
  return withAuth<{ description: string } | null>(async ({ isPro, userId }) => {
    const parseResult = parseOrFail(generateDescriptionSchema, rawInput)

    return runProAiGeneration({
      isPro,
      userId,
      parseResult,
      rateLimitKey: 'aiDescription',
      notConfiguredMessage: 'AI description generation is not configured.',
      failureMessage: 'Failed to generate description.',
      log: itemLog,
      logLabel: 'AI item description',
      execute: async (client, data) =>
        requestDescription(
          client,
          ITEM_DESCRIPTION_SYSTEM_PROMPT,
          buildItemAiUserMessage(data),
          ITEM_MAX_DESCRIPTION_CHARS,
          itemLog,
          { itemType: data.itemType }
        ),
    })
  }, 'generateDescription')
}

export async function generateCollectionDescription(
  rawInput: unknown
): Promise<ApiBody<{ description: string } | null>> {
  return withAuth<{ description: string } | null>(async ({ isPro, userId }) => {
    const parseResult = parseOrFail(generateCollectionDescriptionSchema, rawInput)

    return runProAiGeneration({
      isPro,
      userId,
      parseResult,
      rateLimitKey: 'aiDescription',
      notConfiguredMessage: 'AI description generation is not configured.',
      failureMessage: 'Failed to generate description.',
      log: collectionLog,
      logLabel: 'AI collection description',
      execute: async (client, data) =>
        requestDescription(
          client,
          COLLECTION_DESCRIPTION_SYSTEM_PROMPT,
          `Collection name: ${data.name}`,
          COLLECTION_MAX_DESCRIPTION_CHARS,
          collectionLog,
          { nameLength: data.name.length }
        ),
    })
  }, 'generateCollectionDescription')
}
