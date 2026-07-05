import 'server-only'
import { headers } from 'next/headers'
import { isTcpRedis } from '@/lib/infra/redis'
import { resetTcpLimitersForTests, tcpRateLimit } from '@/lib/infra/rate-limit-tcp'
import { resetUpstashLimitersForTests, upstashRateLimit } from '@/lib/infra/rate-limit-upstash'
import type { RateLimitBackend, RateLimitCheckResult, RateLimitConfig } from '@/lib/infra/rate-limit-types'
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

// Auth rate limit thresholds — adjust here to change any limit
const LIMIT_CONFIG: Record<RateLimitKey, RateLimitConfig> = {
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

// Backend selection (Strategy): node-redis + rate-limiter-flexible on long-running deployments
// (REDIS_URL set), the connectionless Upstash REST limiter on Vercel. This module depends only on
// the RateLimitBackend abstraction — each backend keeps its own dependencies out of the other's
// deployment. Selected per-call because isTcpRedis() is an env read, not a build constant.
function backend(): RateLimitBackend {
  return isTcpRedis() ? tcpRateLimit : upstashRateLimit
}

/** Resets cached limiters (both backends) — for tests only. */
export function resetRateLimitersForTests(): void {
  resetTcpLimitersForTests()
  resetUpstashLimitersForTests()
}

// Hard ceiling on a single rate-limit check. The TCP backend (node-redis) has a 5s
// connectTimeout but no per-command deadline, so a command issued while the client is stuck
// reconnecting to an unreachable store (e.g. a wrong-identity Valkey AUTH that never
// succeeds) never rejects — it blocks until the ingress LB's ~30s backend timeout fires and
// returns a 502. Racing the check against this deadline converts that hang into a fast
// fail-closed decision, so a Redis outage degrades to a 429, never a black-holed request.
const RATE_LIMIT_CHECK_TIMEOUT_MS = 3000

async function check(key: RateLimitKey, identifier: string): Promise<RateLimitCheckResult> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('rate-limit check timed out')), RATE_LIMIT_CHECK_TIMEOUT_MS).unref(),
    )
    return await Promise.race([backend().check(key, identifier, LIMIT_CONFIG[key]), timeout])
  } catch {
    // The store is unreachable or too slow (backend rejected, or the race above timed out) —
    // fail closed in production, open in dev so local work isn't blocked by a missing Redis.
    return process.env.NODE_ENV === 'production'
      ? { success: false, remaining: 0, retryAfter: 60 }
      : { success: true, remaining: 1, retryAfter: 0 }
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

/** Clears the entire window for this key — a full reset (delete/zero the counter), not a single-token decrement. */
export async function resetRateLimit(key: RateLimitKey, identifier: string): Promise<void> {
  try {
    await backend().reset(key, identifier, LIMIT_CONFIG[key])
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
// pool). Surfaced by the dashboard AI Usage widget via the non-consuming `getRemainingMany` read.
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

interface UsageEntry {
  key: string
  limit: number
  remaining: number
  resetAt: number
}

/**
 * Non-consuming budget read for a set of rate-limit keys — the shared read+map core behind the AI
 * and Brain Dump meters. Issues the reads in one tick (Upstash auto-pipelines them) and maps each
 * result to `{key, limit, remaining, resetAt}`. Throws on backend error; callers own the fail-open
 * fallback (they log/degrade differently).
 */
async function readUsage(keys: RateLimitKey[], identifier: string): Promise<UsageEntry[]> {
  const results = await backend().getRemainingMany(
    keys.map((key) => ({ key, identifier, config: LIMIT_CONFIG[key] })),
  )
  return keys.map((key, i) => ({
    key,
    limit: LIMIT_CONFIG[key].attempts,
    remaining: results[i].remaining,
    resetAt: results[i].resetAt,
  }))
}

/**
 * Reads the remaining AI budget per feature for a user WITHOUT consuming a token (a non-consuming
 * read, never `check()`). Delegates to the active backend's `getRemainingMany`, which on Upstash issues
 * the reads in one tick so auto-pipelining collapses them into a single round-trip.
 *
 * Always fails OPEN (full budget per feature) on any error, regardless of NODE_ENV — the meter is
 * observability, never enforcement, so it must never block the UI or mislead the user into thinking
 * they are throttled. A single try/catch degrades the whole payload (never a mix of real + zeroed).
 */
export async function getAiUsage(userId: string): Promise<AiFeatureUsage[]> {
  try {
    // readUsage already sets `key` from the same AI_RATE_LIMIT_KEYS in order; the cast just
    // narrows the string key to the AiRateLimitKey literal the return type wants.
    return (await readUsage([...AI_RATE_LIMIT_KEYS], userId)) as AiFeatureUsage[]
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
  try {
    // Single read = one-element batch (the interface is batch-only; see RateLimitBackend).
    const [{ remaining, resetAt }] = await readUsage(['aiBrainDump'], userId)
    return { key: 'aiBrainDump', limit, remaining, resetAt }
  } catch (err) {
    aiUsageLog.warn({ userId, err }, 'brain-dump usage read failed — failing open with full budget')
    return { key: 'aiBrainDump', limit, remaining: limit, resetAt: 0 }
  }
}
