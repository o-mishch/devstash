import 'server-only'
import type OpenAI from 'openai'
import { ORPCError } from '@orpc/server'
import { getOpenAIClient } from '@/lib/ai/openai'
import { getItemAiMetadata } from '@/lib/db/items'
import { enforceRateLimit } from '@/lib/api/middleware'
import { type RateLimitKey } from '@/lib/infra/rate-limit'
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
  data: TData
  rateLimitKey: RateLimitKey
  notConfiguredMessage: string
  failureMessage: string
  log: Logger
  logLabel: string
  execute: (client: OpenAI, data: TData) => Promise<TResult | null>
}

/**
 * Shared Pro-AI orchestration: Pro gate (→ 403), per-user rate limit (→ 429), OpenAI client
 * availability (→ 500), then `execute`. Throws ORPCError on any failure; returns the result.
 * Input is already validated by the contract before this runs.
 */
export async function runProAiGeneration<TData, TResult>(
  params: RunProAiGenerationParams<TData, TResult>
): Promise<TResult> {
  const { isPro, userId, data, rateLimitKey, notConfiguredMessage, failureMessage, log, logLabel, execute } = params

  if (!isPro) {
    throw new ORPCError('FORBIDDEN', { message: 'This feature requires a Pro subscription.' })
  }

  await enforceRateLimit(rateLimitKey, userId)

  const client = getOpenAIClient()
  if (!client) {
    log.error('OpenAI client is not configured')
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: notConfiguredMessage })
  }

  log.info({ userId }, `Generating ${logLabel} via OpenAI`)

  let result: TResult | null
  try {
    result = await execute(client, data)
  } catch (error) {
    log.error({ err: error }, 'OpenAI API Error')
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: failureMessage })
  }

  if (result == null) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: failureMessage })
  }

  log.info({ userId }, `Successfully generated ${logLabel}`)
  return result
}
