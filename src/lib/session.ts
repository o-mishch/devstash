import { cache } from 'react'
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { ApiResponse } from '@/lib/api'
import { createLogger } from '@/lib/infra/logger'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { z } from 'zod'
import { parseOrFail } from '@/lib/utils/validators'
import type { ApiBody } from '@/types/api'
import { rateLimitAction, type RateLimitKey } from '@/lib/infra/rate-limit'

const log = createLogger('session')

export async function getSession() {
  try {
    return await auth()
  } catch (error) {
    log.warn('Failed to read auth session', { error })
    return null
  }
}

/** Request-scoped session — deduplicates auth reads within a single server render. */
export const getCachedSession = cache(getSession)

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getCachedSession()
  return session?.user?.id ?? null
}

export async function requireUserId(): Promise<string> {
  const session = await getCachedSession()
  if (!session?.user?.id) notFound()
  return session.user.id
}

export interface AuthenticatedSessionUser {
  userId: string
  email: string | null | undefined
}

/** Returns the signed-in user or null. Use for redirect actions that cannot use `withAuth`. */
export async function requireAuthSession(): Promise<AuthenticatedSessionUser | null> {
  const session = await getCachedSession()
  if (!session?.user?.id) return null
  return { userId: session.user.id, email: session.user.email }
}

export interface AuthSessionRateLimitSuccess {
  ok: true
  session: AuthenticatedSessionUser
}

export interface AuthSessionRateLimitFailure {
  ok: false
  response: ApiBody<null>
}

export type AuthSessionRateLimitOutcome = AuthSessionRateLimitSuccess | AuthSessionRateLimitFailure

/** Auth + rate-limit check for server actions that redirect instead of returning `withAuth` envelopes. */
export async function requireAuthSessionWithRateLimit(
  rateLimitKey: RateLimitKey,
): Promise<AuthSessionRateLimitOutcome> {
  const session = await requireAuthSession()
  if (!session) {
    return { ok: false, response: ApiResponse.UNAUTHORIZED('Not authenticated.') }
  }

  const rateLimit = await rateLimitAction(rateLimitKey, session.userId)
  if (rateLimit) {
    return { ok: false, response: rateLimit }
  }

  return { ok: true, session }
}

export interface SessionContext {
  userId: string
  isPro: boolean
}

export async function withAuth<T>(
  fn: (ctx: SessionContext) => Promise<ApiBody<T>>,
  context?: string
): Promise<ApiBody<T>> {
  const session = await getCachedSession()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.') as ApiBody<T>
  try {
    const isPro = await getCachedVerifiedProAccess(session.user.id)
    return await fn({ userId: session.user.id, isPro })
  } catch (error) {
    log.error('Auth action failed', { context: context ?? 'action', error })
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
