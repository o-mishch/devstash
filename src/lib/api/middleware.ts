import 'server-only'
import { ORPCError } from '@orpc/server'
import { checkRateLimit, deniedMessage, type RateLimitKey } from '@/lib/infra/rate-limit'

/**
 * Per-procedure rate limiting for oRPC handlers. Call at the top of a handler with the limit key,
 * identifier (userId for authed procedures), and `context.resHeaders` (from the ResponseHeadersPlugin).
 * On limit it sets `Retry-After` and throws ORPCError('TOO_MANY_REQUESTS') → 429, mirroring the
 * legacy `rateLimitRoute`.
 */
export async function enforceRateLimit(
  key: RateLimitKey,
  identifier: string,
  resHeaders?: Headers,
): Promise<void> {
  const { success, retryAfter } = await checkRateLimit(key, identifier)
  if (!success) {
    resHeaders?.set('Retry-After', String(retryAfter))
    throw new ORPCError('TOO_MANY_REQUESTS', { message: deniedMessage(retryAfter) })
  }
}
