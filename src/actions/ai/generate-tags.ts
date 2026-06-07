'use server'

import { z } from 'zod'
import { ApiResponse } from '@/lib/api'
import { withAuth } from '@/lib/session'
import { rateLimitAction } from '@/lib/rate-limit'
import { parseOrFail } from '@/lib/utils/validators'
import { getOpenAIClient, AI_MODELS } from '@/lib/ai/openai'
import { createLogger } from '@/lib/logger'
import type { ApiBody } from '@/types/api'

const log = createLogger('generate-tags')

const generateTagsSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(2000),
  content: z.string().trim().max(2000).optional(),
})

export type GenerateTagsInput = z.infer<typeof generateTagsSchema>

const tagSchema = z.string().trim().min(1).max(50)
const tagResponseSchema = z.union([
  z.object({ tags: z.array(tagSchema).max(5) }),
  z.array(tagSchema).max(5),
])

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
    if (!isPro) {
      return ApiResponse.FORBIDDEN('This feature requires a Pro subscription.')
    }

    const rl = await rateLimitAction('aiTags', userId)
    if (rl) return rl as ApiBody<string[] | null>

    const parseResult = parseOrFail(generateTagsSchema, rawInput)
    if (!parseResult.success) return parseResult.response

    const { title, content } = parseResult.data
    const client = getOpenAIClient()
    if (!client) {
      log.error('OpenAI client is not configured')
      return ApiResponse.INTERNAL_ERROR('AI tag generation is not configured.')
    }

    const systemPrompt = `You are an expert tag generator for a developer knowledge base.
Your task is to suggest 3-5 highly relevant, concise, and specific tags based on the provided title and content.
Return the result strictly as a JSON object with a single "tags" property containing an array of strings.
Example: { "tags": ["react", "hooks", "typescript"] }
Do not include any other text or properties.`

    const userMessage = `Title: ${title}\nContent: ${content || ''}`.trim()

    log.info('Generating AI tags via OpenAI', { userId, model: AI_MODELS.TAG, titleLength: title.length })

    try {
      const completion = await client.responses.create({
        model: AI_MODELS.TAG,
        instructions: systemPrompt,
        input: userMessage,
      })

      const responseContent = completion.output_text
      if (!responseContent) {
        throw new Error('No content returned from OpenAI')
      }

      const normalizedTags = parseTagsResponse(responseContent)
      if (!normalizedTags) {
        log.error('Failed to parse OpenAI JSON response', { responseLength: responseContent.length })
        return ApiResponse.INTERNAL_ERROR('Failed to generate tags.')
      }

      log.info('Successfully generated AI tags', { userId, count: normalizedTags.length })

      return ApiResponse.OK(normalizedTags)
    } catch (error) {
      log.error('OpenAI API Error', error)
      return ApiResponse.INTERNAL_ERROR('Failed to generate tags.')
    }
  }, 'generateAutoTags')
}
