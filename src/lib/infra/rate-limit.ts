import 'server-only'
import { Ratelimit, type Duration } from '@upstash/ratelimit'
import { headers } from 'next/headers'
import { getRedis, isTcpRedis, RATE_LIMIT_NS } from '@/lib/infra/redis'
import { tcpCheck, tcpResetBucket } from '@/lib/infra/rate-limit-tcp'
import { logger } from '@/lib/infra/pino'
import { AI_FEATURE_HOURLY_LIMIT } from '@/lib/utils/constants'
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
  | 'aiOptimize'
  | 'aiBrainDump'
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
  aiTags:               { attempts: AI_FEATURE_HOURLY_LIMIT, window: '1 h' }, // keyed by userId — OpenAI usage
  aiDescription:        { attempts: AI_FEATURE_HOURLY_LIMIT, window: '1 h' }, // keyed by userId — OpenAI usage
  aiExplain:            { attempts: AI_FEATURE_HOURLY_LIMIT, window: '1 h' }, // keyed by userId — OpenAI usage (code explanations)
  aiOptimize:           { attempts: AI_FEATURE_HOURLY_LIMIT, window: '1 h' }, // keyed by userId — OpenAI usage (prompt optimization)
  aiBrainDump:          { attempts: 1, window: '1 h' }, // keyed by userId — heavy streaming split (Brain Dump), 1 per hour
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
    // ioredis path (Memorystore / local): @upstash/ratelimit needs the REST client,
    // so the TCP backend runs the same algorithm in rate-limit-tcp.ts.
    if (isTcpRedis()) return await tcpCheck(key, identifier, LIMIT_CONFIG[key])
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

const rateLimitLog = logger.child({ tag: 'rate-limit' })

/** Resets the full usage counter for the window (i.e. refunds all consumed tokens in the current window). */
export async function resetRateLimit(key: RateLimitKey, identifier: string): Promise<void> {
  try {
    if (isTcpRedis()) {
      await tcpResetBucket(key, identifier)
      return
    }
    const l = getLimiters()
    if (!l) return
    // WARNING: Upstash resetUsedTokens zeroes the entire window (all consumed tokens), not just one decrement.
    await l[key].resetUsedTokens(identifier)
  } catch (err) {
    rateLimitLog.warn({ key, identifier, err }, 'rate-limit reset failed')
  }
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

// ── AI usage meter (read-only observability) ────────────────────────────────────────────────────
// The four per-feature AI buckets, each its own AI_FEATURE_HOURLY_LIMIT rolling window (no shared
// pool). Surfaced by the dashboard AI Usage widget via the non-consuming `getRemaining` read.
export const AI_RATE_LIMIT_KEYS = ['aiOptimize', 'aiExplain', 'aiTags', 'aiDescription'] as const

export type AiRateLimitKey = (typeof AI_RATE_LIMIT_KEYS)[number]

export interface AiFeatureUsage {
  key: AiRateLimitKey
  limit: number
  remaining: number
  // Epoch ms at which the oldest counted hit slides out of the window (next slot frees up).
  resetAt: number
}

const aiUsageLog = logger.child({ tag: 'ai-usage' })

/** Full-budget entry for a key — the fail-open value (never spends a token, never blocks the UI). */
function fullBudget(key: AiRateLimitKey): AiFeatureUsage {
  const limit = LIMIT_CONFIG[key].attempts
  return { key, limit, remaining: limit, resetAt: 0 }
}

/**
 * Reads the remaining AI budget per feature for a user WITHOUT consuming a token (`getRemaining`,
 * never `limit()`/`check()`). The four reads fire synchronously before one `await Promise.all`, so
 * with `enableAutoPipelining` they collapse to a single `/pipeline` round-trip.
 *
 * Always fails OPEN (full budget per feature) on any error or missing limiters, regardless of
 * NODE_ENV — the meter is observability, never enforcement, so it must never block the UI or
 * mislead the user into thinking they are throttled. A single try/catch degrades the whole payload
 * (never a mix of real + zeroed entries).
 */
export async function getAiUsage(userId: string): Promise<AiFeatureUsage[]> {
  try {
    const l = getLimiters()
    if (!l) {
      // Static config state (Redis unconfigured), not an incident — keep it at debug so the 60s
      // per-Pro-user poll never floods logs. Real read failures still surface via the catch below.
      aiUsageLog.debug({ userId }, 'ai usage read skipped — no limiters (Redis unconfigured), failing open with full budget')
      return AI_RATE_LIMIT_KEYS.map(fullBudget)
    }

    // Fire all four reads synchronously (no `await` between them) so auto-pipelining groups them.
    const reads = AI_RATE_LIMIT_KEYS.map((key) => l[key].getRemaining(userId))
    const results = await Promise.all(reads)

    return AI_RATE_LIMIT_KEYS.map((key, i) => ({
      key,
      limit: LIMIT_CONFIG[key].attempts,
      remaining: results[i].remaining,
      resetAt: results[i].reset,
    }))
  } catch (err) {
    aiUsageLog.warn({ userId, err }, 'ai usage read failed — failing open with full budget')
    return AI_RATE_LIMIT_KEYS.map(fullBudget)
  }
}

// Brain Dump (`aiBrainDump`) quota, read WITHOUT consuming a token. Surfaced separately from the 4-up
// `features` grid (its key is intentionally not in AI_RATE_LIMIT_KEYS). Same key shape as a feature
// meter (`key` is a free string here) so the dashboard Bulk-parse card reuses the meter treatment.
// Always fails OPEN (full budget) — it is observability, never enforcement.
export interface BrainDumpUsage {
  key: string
  limit: number
  remaining: number
  resetAt: number
}

export async function getBrainDumpUsage(userId: string): Promise<BrainDumpUsage> {
  const limit = LIMIT_CONFIG.aiBrainDump.attempts
  const fullOpen: BrainDumpUsage = { key: 'aiBrainDump', limit, remaining: limit, resetAt: 0 }
  try {
    const l = getLimiters()
    if (!l) {
      aiUsageLog.debug({ userId }, 'brain-dump usage read skipped — no limiters, failing open')
      return fullOpen
    }
    const { remaining, reset } = await l.aiBrainDump.getRemaining(userId)
    return { key: 'aiBrainDump', limit, remaining, resetAt: reset }
  } catch (err) {
    aiUsageLog.warn({ userId, err }, 'brain-dump usage read failed — failing open with full budget')
    return fullOpen
  }
}
