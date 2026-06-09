import type OpenAI from 'openai'
import { ApiResponse } from '@/lib/api'
import { getOpenAIClient } from '@/lib/ai/openai'
import { rateLimitAction, type RateLimitKey } from '@/lib/infra/rate-limit'
import type { ParseResult } from '@/lib/utils/validators'
import type { ApiBody } from '@/types/api'
import type { createLogger } from '@/lib/infra/logger'

type AiGenerationLogger = ReturnType<typeof createLogger>

export interface RunProAiGenerationParams<TData, TResult> {
  isPro: boolean
  userId: string
  parseResult: ParseResult<TData>
  rateLimitKey: RateLimitKey
  notConfiguredMessage: string
  failureMessage: string
  log: AiGenerationLogger
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

  log.info(`Generating ${logLabel} via OpenAI`, { userId })

  try {
    const result = await execute(client, parseResult.data)
    if (result == null) {
      return ApiResponse.INTERNAL_ERROR(failureMessage)
    }

    log.info(`Successfully generated ${logLabel}`, { userId })
    return ApiResponse.OK(result)
  } catch (error) {
    log.error('OpenAI API Error', error)
    return ApiResponse.INTERNAL_ERROR(failureMessage)
  }
}
