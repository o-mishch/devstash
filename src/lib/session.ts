import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { ApiResponse } from '@/lib/api'
import { createLogger } from '@/lib/logger'
import { z } from 'zod'
import { parseOrFail } from '@/lib/utils/validators'
import type { ApiBody } from '@/types/api'
import { rateLimitAction, type RateLimitKey } from '@/lib/rate-limit'

const log = createLogger('session')

export async function getSession() {
  try {
    return await auth()
  } catch {
    return null
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user?.id ?? null
}

export async function requireUserId(): Promise<string> {
  const session = await getSession()
  if (!session?.user?.id) notFound()
  return session.user.id
}

export interface SessionContext {
  userId: string
  isPro: boolean
}

export async function withAuth<T>(
  fn: (ctx: SessionContext) => Promise<ApiBody<T>>,
  context?: string
): Promise<ApiBody<T>> {
  const session = await getSession()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.') as ApiBody<T>
  try {
    return await fn({ userId: session.user.id, isPro: session.user.isPro ?? false })
  } catch (error) {
    log.error(`${context ?? 'action'} failed`, error)
    return ApiResponse.INTERNAL_ERROR() as ApiBody<T>
  }
}

export async function withAuthAndRateLimit<T>(
  rateLimitKey: RateLimitKey,
  fn: (ctx: SessionContext) => Promise<ApiBody<T>>,
  context?: string
): Promise<ApiBody<T>> {
  return withAuth(async ({ userId, isPro }) => {
    const rl = await rateLimitAction(rateLimitKey, userId)
    if (rl) return rl as ApiBody<T>
    return await fn({ userId, isPro })
  }, context)
}

export async function withValidatedAuth<T, Output>(
  schema: z.ZodType<Output>,
  raw: unknown,
  fn: (ctx: SessionContext, data: Output) => Promise<ApiBody<T>>,
  context?: string
): Promise<ApiBody<T>> {
  return withAuth(async ({ userId, isPro }) => {
    const result = parseOrFail<Output>(schema, raw)
    if (!result.success) return result.response as ApiBody<T>
    return await fn({ userId, isPro }, result.data)
  }, context)
}
