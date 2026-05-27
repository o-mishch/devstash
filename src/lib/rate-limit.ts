import { Ratelimit, type Duration } from '@upstash/ratelimit'
import { headers } from 'next/headers'
import { getRedis } from '@/lib/redis-cache'
import { RATE_LIMIT_NS } from '@/lib/redis-cache'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'

type RateLimitKey =
  | 'login'
  | 'register'
  | 'forgotPassword'
  | 'resetPassword'
  | 'resendVerification'
  | 'resendVerificationIP'
  | 'linkAccount'

interface LimitConfig {
  attempts: number
  window: Duration
}

// Auth rate limit thresholds — adjust here to change any limit
const LIMIT_CONFIG: Record<RateLimitKey, LimitConfig> = {
  login:                { attempts: 5,  window: '15 m' }, // keyed by IP + email
  register:             { attempts: 3,  window: '1 h'  }, // keyed by IP
  forgotPassword:       { attempts: 3,  window: '1 h'  }, // keyed by IP
  resetPassword:        { attempts: 5,  window: '15 m' }, // keyed by IP
  resendVerification:   { attempts: 3,  window: '15 m' }, // keyed by IP + email
  resendVerificationIP: { attempts: 10, window: '15 m' }, // keyed by IP (broad guard before body parse)
  linkAccount:          { attempts: 5,  window: '15 m' }, // keyed by IP
}

interface RouteRateLimitDenied {
  body: ApiBody<null>
  headers: Record<string, string>
}

// Lazily initialized so missing env vars fail open rather than crashing at import
let limiters: Record<RateLimitKey, Ratelimit> | null = null

function getLimiters(): Record<RateLimitKey, Ratelimit> | null {
  if (limiters) return limiters
  try {
    const redis = getRedis()
    if (!redis) return null
    limiters = Object.fromEntries(
      Object.entries(LIMIT_CONFIG).map(([key, { attempts, window }]) => [
        key,
        new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(attempts, window), prefix: `${RATE_LIMIT_NS}:${key}` }),
      ])
    ) as Record<RateLimitKey, Ratelimit>
    return limiters
  } catch {
    return null
  }
}

async function check(key: RateLimitKey, identifier: string) {
  try {
    const l = getLimiters()
    if (!l) return { success: true, remaining: 1, retryAfter: 0 }
    const { success, remaining, reset } = await l[key].limit(identifier)
    const retryAfter = Math.max(0, Math.ceil((reset - Date.now()) / 1000))
    return { success, remaining, retryAfter }
  } catch {
    // Fail open — allow requests when Upstash is unavailable
    return { success: true, remaining: 1, retryAfter: 0 }
  }
}

function deniedMessage(retryAfter: number): string {
  const minutes = Math.ceil(retryAfter / 60)
  return minutes > 1
    ? `Too many attempts. Please try again in ${minutes} minutes.`
    : 'Too many attempts. Please try again in a moment.'
}

export function getRequestIP(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1'
}

export async function getActionIP(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1'
}

/** For use inside `apiRoute` handlers. Returns the denied response or null if allowed. */
export async function rateLimitRoute(
  key: RateLimitKey,
  identifier: string
): Promise<RouteRateLimitDenied | null> {
  const result = await check(key, identifier)
  if (result.success) return null
  return {
    body: ApiResponse.TOO_MANY_REQUESTS(deniedMessage(result.retryAfter)),
    headers: { 'Retry-After': String(result.retryAfter) },
  }
}

/** For use inside Server Actions. Returns the denied ApiBody or null if allowed. */
export async function rateLimitAction(
  key: RateLimitKey,
  identifier: string
): Promise<ApiBody<null> | null> {
  const result = await check(key, identifier)
  if (result.success) return null
  return ApiResponse.TOO_MANY_REQUESTS(deniedMessage(result.retryAfter))
}

/** 
 * Higher-order action wrapper for standardized rate-limiting.
 * Automatically checks the rate limit using the action's IP. 
 */
export async function withRateLimit<T>(
  key: RateLimitKey,
  fn: () => Promise<ApiBody<T>>
): Promise<ApiBody<T>> {
  const rl = await rateLimitAction(key, await getActionIP())
  if (rl) return rl as ApiBody<T>
  return fn()
}
