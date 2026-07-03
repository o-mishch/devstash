// Shared contract + key namespace for the rate-limit dispatcher and its two interchangeable
// backends — Upstash REST (Vercel) and node-redis + rate-limiter-flexible (self-hosted). Holds no
// backend-specific type (no @upstash import) and no runtime dependency on either backend, so both
// sides — including the self-hosted one — can import it freely.

// Redis key namespace for every limiter bucket: keys take the form `rl:<action>:<identifier>`.
export const RATE_LIMIT_NS = 'rl'

// A rate-limit window, e.g. '15 m' or '1 h'. Structurally a subset of @upstash/ratelimit's own
// `Duration`, so it's assignable to `Ratelimit.slidingWindow(...)` without importing that type here.
type DurationUnit = 'ms' | 's' | 'm' | 'h' | 'd'
export type Duration = `${number} ${DurationUnit}`

export interface RateLimitConfig {
  attempts: number
  window: Duration
}

export interface RateLimitCheckResult {
  success: boolean
  remaining: number
  retryAfter: number
}

export interface RateLimitRemaining {
  remaining: number
  // Epoch ms at which the window resets (next slot frees up); 0 when there is no active window —
  // the "full budget" shape the AI-usage meter expects.
  resetAt: number
}

export interface RateLimitReadRequest {
  key: string
  identifier: string
  config: RateLimitConfig
}

/**
 * Strategy contract each backend implements. rate-limit.ts depends only on this abstraction and
 * selects the concrete backend by environment (DIP), so neither backend's dependencies leak into
 * the other deployment. Reads are batch-only (`getRemainingMany`) — a single read is a one-element
 * batch — so a backend can issue them together (Upstash pipelines them into one round-trip). A
 * store failure rejects so the caller applies its fail-open/closed policy.
 */
export interface RateLimitBackend {
  check(key: string, identifier: string, config: RateLimitConfig): Promise<RateLimitCheckResult>
  getRemainingMany(requests: RateLimitReadRequest[]): Promise<RateLimitRemaining[]>
  reset(key: string, identifier: string, config: RateLimitConfig): Promise<void>
}
