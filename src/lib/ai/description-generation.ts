import 'server-only'
import type OpenAI from 'openai'
import { ApiResponse } from '@/lib/api'
import { getOpenAIClient } from '@/lib/ai/openai'
import { getItemAiMetadata } from '@/lib/db/items'
import { rateLimitAction, type RateLimitKey } from '@/lib/infra/rate-limit'
import type { ParseResult } from '@/lib/utils/validators'
import type { ApiBody } from '@/types/api'
import type { Logger } from 'pino'

interface ItemImageLookup {
  itemType: string
  itemId?: string
}

interface ItemImageDimensions {
  imageWidth?: number
  imageHeight?: number
}

type OpenAiCompletionRequest = Pick<
  OpenAI.Responses.ResponseCreateParamsNonStreaming,
  'model' | 'instructions' | 'input'
>

/**
 * Runs a single OpenAI Responses completion and parses its text output: throws when the
 * model returns no content, logs + returns `null` when the parser rejects the output.
 */
export async function runOpenAiCompletion<TResult>(
  client: OpenAI,
  request: OpenAiCompletionRequest,
  parse: (responseContent: string) => TResult | null,
  log: Logger,
): Promise<TResult | null> {
  const completion = await client.responses.create(request)

  const responseContent = completion.output_text
  if (!responseContent) {
    throw new Error('No content returned from OpenAI')
  }

  const result = parse(responseContent)
  if (result == null) {
    log.error({ responseLength: responseContent.length }, 'Failed to parse OpenAI JSON response')
    return null
  }

  return result
}

/** Stored image dimensions for an image item (used to enrich AI prompts); empty for non-image items. */
export async function resolveItemImageDimensions(
  userId: string,
  item: ItemImageLookup,
): Promise<ItemImageDimensions> {
  if (item.itemType !== 'image' || !item.itemId) return {}
  const dims = await getItemAiMetadata(userId, item.itemId)
  return {
    imageWidth: dims?.imageWidth ?? undefined,
    imageHeight: dims?.imageHeight ?? undefined,
  }
}

export interface RunProAiGenerationParams<TData, TResult> {
  isPro: boolean
  userId: string
  parseResult: ParseResult<TData>
  rateLimitKey: RateLimitKey
  notConfiguredMessage: string
  failureMessage: string
  log: Logger
  logLabel: string
  execute: (client: OpenAI, data: TData) => Promise<TResult | null>
}

export async function runProAiGeneration<TData, TResult>(
  params: RunProAiGenerationParams<TData, TResult>
): Promise<ApiBody<TResult | null>> {
  const {
    isPro,
    userId,
    parseResult,
    rateLimitKey,
    notConfiguredMessage,
    failureMessage,
    log,
    logLabel,
    execute,
  } = params

  if (!isPro) {
    return ApiResponse.FORBIDDEN('This feature requires a Pro subscription.')
  }

  const rl = await rateLimitAction(rateLimitKey, userId)
  if (rl) return rl as ApiBody<TResult | null>

  if (!parseResult.success) return parseResult.response

  const client = getOpenAIClient()
  if (!client) {
    log.error('OpenAI client is not configured')
    return ApiResponse.INTERNAL_ERROR(notConfiguredMessage)
  }

  log.info({ userId }, `Generating ${logLabel} via OpenAI`)

  try {
    const result = await execute(client, parseResult.data)
    if (result == null) {
      return ApiResponse.INTERNAL_ERROR(failureMessage)
    }

    log.info({ userId }, `Successfully generated ${logLabel}`)
    return ApiResponse.OK(result)
  } catch (error) {
    log.error({ err: error }, 'OpenAI API Error')
    return ApiResponse.INTERNAL_ERROR(failureMessage)
  }
}
