import 'server-only'
import { Ratelimit, type Duration } from '@upstash/ratelimit'
import { headers } from 'next/headers'
import { getRedis, RATE_LIMIT_NS } from '@/lib/infra/redis'
import type { ActionState } from '@/types/actions'

export type RateLimitKey =
  | 'login'
  | 'loginIP'
  | 'loginAuthorizeIP'
  | 'register'
  | 'forgotPassword'
  | 'resetPassword'
  | 'resendVerification'
  | 'resendVerificationIP'
  | 'linkAccount'
  | 'updateSettings'
  | 'changePassword'
  | 'changeCredentials'
  | 'credentialEmail'
  | 'confirmLoginEmail'
  | 'aiTags'
  | 'aiDescription'
  | 'aiExplain'
  | 'stripeCheckout'
  | 'stripePortal'
  | 'stripeSubscription'
  | 'stripeSync'
  | 'deleteAccount'
  | 'itemMutation'
  | 'uploadUrl'

interface LimitConfig {
  attempts: number
  window: Duration
}

// Auth rate limit thresholds — adjust here to change any limit
const LIMIT_CONFIG: Record<RateLimitKey, LimitConfig> = {
  login:                { attempts: 5,  window: '15 m' }, // keyed by IP + email
  loginIP:              { attempts: 20, window: '1 m'  }, // keyed by IP — broad guard before bcrypt in the /login route
  loginAuthorizeIP:     { attempts: 20, window: '1 m'  }, // keyed by IP — separate bucket for NextAuth authorize() so a successful /login (route guard + authorize) isn't charged twice against one budget
  register:             { attempts: 3,  window: '1 h'  }, // keyed by IP
  forgotPassword:       { attempts: 3,  window: '1 h'  }, // keyed by IP
  resetPassword:        { attempts: 5,  window: '15 m' }, // keyed by IP
  resendVerification:   { attempts: 3,  window: '15 m' }, // keyed by IP + email
  resendVerificationIP: { attempts: 10, window: '15 m' }, // keyed by IP (broad guard before body parse)
  linkAccount:          { attempts: 5,  window: '15 m' }, // keyed by IP
  updateSettings:       { attempts: 60, window: '1 m'  }, // keyed by userId
  changePassword:       { attempts: 5,  window: '15 m' }, // keyed by userId
  changeCredentials:    { attempts: 5,  window: '15 m' }, // keyed by userId — email/password changes
  credentialEmail:      { attempts: 5,  window: '15 m' }, // keyed by userId — credential-login email requests
  confirmLoginEmail:    { attempts: 5,  window: '15 m' }, // keyed by IP — public credential-email confirm
  aiTags:               { attempts: 20, window: '1 h'  }, // keyed by userId — OpenAI usage
  aiDescription:        { attempts: 20, window: '1 h'  }, // keyed by userId — OpenAI usage
  aiExplain:            { attempts: 20, window: '1 h'  }, // keyed by userId — OpenAI usage (code explanations)
  stripeCheckout:       { attempts: 10, window: '1 h'  }, // keyed by userId — Stripe Checkout sessions
  stripePortal:         { attempts: 20, window: '1 h'  }, // keyed by userId — Billing Portal sessions
  stripeSubscription:   { attempts: 10, window: '1 h'  }, // keyed by userId — cancel / reactivate
  stripeSync:           { attempts: 10, window: '1 h'  }, // keyed by userId — post-checkout finalize / manual sync
  deleteAccount:        { attempts: 3,  window: '1 h'  }, // keyed by userId — account deletion
  itemMutation:         { attempts: 120, window: '1 h'  }, // keyed by userId — create/update/delete/toggle items
  uploadUrl:            { attempts: 30,  window: '1 h'  }, // keyed by userId — presign requests (Pro only)
}

// Lazily initialized so missing env vars fail open rather than crashing at import
let limiters: Record<RateLimitKey, Ratelimit> | null = null

/** Resets cached limiters — for tests only. */
export function resetRateLimitersForTests(): void {
  limiters = null
}

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
  const failClosed = process.env.NODE_ENV === 'production'
  const allowWhenUnavailable = { success: true as const, remaining: 1, retryAfter: 0 }
  const denyWhenUnavailable = { success: false as const, remaining: 0, retryAfter: 60 }

  try {
    const l = getLimiters()
    if (!l) return failClosed ? denyWhenUnavailable : allowWhenUnavailable
    const { success, remaining, reset } = await l[key].limit(identifier)
    const retryAfter = Math.max(0, Math.ceil((reset - Date.now()) / 1000))
    return { success, remaining, retryAfter }
  } catch {
    return failClosed ? denyWhenUnavailable : allowWhenUnavailable
  }
}

export function deniedMessage(retryAfter: number): string {
  const minutes = Math.ceil(retryAfter / 60)
  return minutes > 1
    ? `Too many attempts. Please try again in ${minutes} minutes.`
    : 'Too many attempts. Please try again in a moment.'
}

export interface RateLimitResult {
  success: boolean
  retryAfter: number
}

/** Envelope-free rate-limit check for the route handlers (see `src/lib/api/route.ts`). */
export async function checkRateLimit(key: RateLimitKey, identifier: string): Promise<RateLimitResult> {
  const { success, retryAfter } = await check(key, identifier)
  return { success, retryAfter }
}

export async function getActionIP(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1'
}

/** For use inside Server Actions. Returns the denied ActionState or null if allowed. */
export async function rateLimitAction(
  key: RateLimitKey,
  identifier: string
): Promise<ActionState | null> {
  const result = await check(key, identifier)
  if (result.success) return null
  return { success: false, message: deniedMessage(result.retryAfter) }
}

/**
 * Higher-order action wrapper for IP-keyed rate limits (auth flows).
 */
export async function withRateLimit<T>(
  key: RateLimitKey,
  fn: () => Promise<ActionState<T>>
): Promise<ActionState<T>> {
  const rl = await rateLimitAction(key, await getActionIP())
  if (rl) return rl as ActionState<T>
  return fn()
}
