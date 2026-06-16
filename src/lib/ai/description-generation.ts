import 'server-only'
import type OpenAI from 'openai'
import { getOpenAIClient } from '@/lib/ai/openai'
import { getItemAiMetadata } from '@/lib/db/items'
import { checkRateLimit, deniedMessage, type RateLimitKey } from '@/lib/infra/rate-limit'
import type { FailureResult } from '@/lib/api/http'
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

// REST-native result for the AI route handlers — `ok` carries the generated value; a failure is a
// FailureResult (status + message + optional retryAfter) the handler maps to a response via
// `problemFrom` (no thrown control-flow, per coding-standards).
export interface AiGenerationFailure extends FailureResult {
  ok: false
}

export type AiGenerationResult<T> = { ok: true; value: T } | AiGenerationFailure

/**
 * Shared Pro-AI orchestration: Pro gate (→ 403), per-user rate limit (→ 429), OpenAI client
 * availability (→ 500), then `execute` (→ 500 on throw/empty). Returns a result the handler maps to
 * a response. The Pro gate runs BEFORE the rate limit so non-Pro callers get 403 without consuming
 * rate-limit budget. Input is validated by the handler before this runs.
 */
export async function runProAiGeneration<TData, TResult>(
  params: RunProAiGenerationParams<TData, TResult>
): Promise<AiGenerationResult<TResult>> {
  const { isPro, userId, data, rateLimitKey, notConfiguredMessage, failureMessage, log, logLabel, execute } = params

  if (!isPro) {
    return { ok: false, status: 403, message: 'This feature requires a Pro subscription.' }
  }

  const { success, retryAfter } = await checkRateLimit(rateLimitKey, userId)
  if (!success) {
    return { ok: false, status: 429, message: deniedMessage(retryAfter), retryAfter }
  }

  const client = getOpenAIClient()
  if (!client) {
    log.error('OpenAI client is not configured')
    return { ok: false, status: 500, message: notConfiguredMessage }
  }

  log.info({ userId }, `Generating ${logLabel} via OpenAI`)

  let result: TResult | null
  try {
    result = await execute(client, data)
  } catch (error) {
    log.error({ err: error }, 'OpenAI API Error')
    return { ok: false, status: 500, message: failureMessage }
  }

  if (result == null) {
    return { ok: false, status: 500, message: failureMessage }
  }

  log.info({ userId }, `Successfully generated ${logLabel}`)
  return { ok: true, value: result }
}
