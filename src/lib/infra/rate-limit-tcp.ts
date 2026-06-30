import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Duration } from '@upstash/ratelimit'
import { getRedis, RATE_LIMIT_NS } from '@/lib/infra/redis'

// Native TCP rate-limit backend (ioredis → Memorystore / local Redis). On
// long-running deployments the app uses ioredis, which @upstash/ratelimit does NOT
// support, so we run the same sliding-window-log algorithm with a single atomic Lua
// script (sorted set per bucket), keyed identically (`rl:<action>:<id>`) — behavior
// matches the Upstash path closely.
//
// Kept OUT of rate-limit.ts so the production (Vercel/Upstash) path stays unchanged:
// rate-limit.ts only delegates here behind `isTcpRedis()`. Config is passed in so
// this module never imports back from rate-limit.ts (no import cycle).

const TCP_SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, now + window}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset = now + window
if oldest[2] then reset = tonumber(oldest[2]) + window end
return {0, 0, reset}`

const WINDOW_UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

function parseWindowMs(window: Duration): number {
  const [amount, unit] = window.split(' ')
  return Number(amount) * (WINDOW_UNIT_MS[unit] ?? 1000)
}

export function tcpBucket(prefix: string, identifier: string): string {
  return `${RATE_LIMIT_NS}:${prefix}:${identifier}`
}

export interface TcpLimitConfig {
  attempts: number
  window: Duration
}

export interface TcpRateLimitResult {
  success: boolean
  remaining: number
  retryAfter: number
}

export async function tcpCheck(
  prefix: string,
  identifier: string,
  { attempts, window }: TcpLimitConfig,
): Promise<TcpRateLimitResult> {
  const redis = getRedis()
  if (!redis) throw new Error('redis unavailable')
  const now = Date.now()
  const [success, remaining, reset] = (await redis.eval(
    TCP_SLIDING_WINDOW,
    [tcpBucket(prefix, identifier)],
    // randomUUID() is 122-bit unique on its own; the timestamp prefix adds no
    // uniqueness and wastes ~14 bytes per sorted-set member in Redis.
    [now, parseWindowMs(window), attempts, randomUUID()],
  )) as [number, number, number]
  return { success: success === 1, remaining, retryAfter: Math.max(0, Math.ceil((reset - now) / 1000)) }
}

/** Deleting the bucket clears the whole window — matches Upstash `resetUsedTokens`. */
export async function tcpResetBucket(prefix: string, identifier: string): Promise<void> {
  const redis = getRedis()
  if (redis) await redis.del(tcpBucket(prefix, identifier))
}
