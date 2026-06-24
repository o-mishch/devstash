import 'server-only'
import { type NextRequest, NextResponse } from 'next/server'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit, deniedMessage, type RateLimitKey } from '@/lib/infra/rate-limit'
import { logger } from '@/lib/infra/pino'
import { isPrerenderInterrupt } from '@/lib/utils/url'
import { ErrorMessage } from './error-messages'
import { problem } from './http'

// Route-handler wrappers that reproduce what the oRPC `authed` implementer + rate-limit middleware
// did, but return plain JSON. Expected non-200 outcomes (401/429) are RETURNED via `problem()` —
// no thrown control-flow (coding-standards.md: no custom Error subclasses, no `instanceof`
// routing). Only genuinely unexpected throws bubble to the single 500 catch. `userId` always comes
// from the session (IDOR-safe), never from request input.

const log = logger.child({ tag: 'api' })

export interface AuthedCtx {
  userId: string
  isPro: boolean
  request: NextRequest
}

export interface PublicCtx {
  request: NextRequest
}

export interface AuthedCtxWithParams<P> extends AuthedCtx {
  params: P
}

export interface AuthedRouteOptions {
  rateLimit?: RateLimitKey
}

type AuthGate = { ok: true; userId: string } | { ok: false; res: NextResponse }

// 429 builder shared by `authGate` and the auth/upload routes that rate-limit inline (IP / IP+email
// keys, or Pro-gated — none can use the `rateLimit` option). Centralizes the status, the human
// message, and the `Retry-After` header so the 429 contract lives in one place. Lives here rather
// than in http.ts because `deniedMessage` is server-only (http.ts is [C], browser-safe).
export function rateLimited(retryAfter: number): NextResponse {
  return problem(429, deniedMessage(retryAfter), undefined, { 'Retry-After': String(retryAfter) })
}

// Session gate (401) + optional per-user rate limit (429 + Retry-After). Pro resolution and the
// handler run inside the caller's try so any unexpected throw becomes a single 500.
async function authGate(opts: AuthedRouteOptions): Promise<AuthGate> {
  const session = await getCachedSession()
  if (!session?.user?.id) return { ok: false, res: problem(401, ErrorMessage.NOT_AUTHENTICATED) }
  const userId = session.user.id

  if (opts.rateLimit) {
    const { success, retryAfter } = await checkRateLimit(opts.rateLimit, userId)
    if (!success) return { ok: false, res: rateLimited(retryAfter) }
  }

  return { ok: true, userId }
}

function fail500(err: unknown, userId?: string): NextResponse {
  // Let Next.js's prerender-abort signal propagate — it's not a 500.
  if (isPrerenderInterrupt(err)) throw err
  log.error({ userId, err }, 'unhandled route error')
  return problem(500, 'Something went wrong. Please try again.')
}

// Public (unauthenticated) routes — no session gate, no Pro resolution. Used by the auth domain,
// whose endpoints run before a session exists. Rate limiting here is IP / IP+email based and varies
// per endpoint (and login only counts FAILED attempts), so it is done inline in each handler rather
// than via an option — the same reason ai/upload gate Pro before rate-limiting. The single 500 catch
// mirrors the authed variants so any unexpected throw becomes one logged 500.
export function publicRoute(handler: (ctx: PublicCtx) => Promise<NextResponse>) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      return await handler({ request })
    } catch (err) {
      return fail500(err)
    }
  }
}

export function authedRoute(
  opts: AuthedRouteOptions,
  handler: (ctx: AuthedCtx) => Promise<NextResponse>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const gate = await authGate(opts)
    if (!gate.ok) return gate.res
    try {
      const isPro = await getCachedVerifiedProAccess(gate.userId)
      return await handler({ userId: gate.userId, isPro, request })
    } catch (err) {
      return fail500(err, gate.userId)
    }
  }
}

// Variant for dynamic segments. Next.js passes `{ params: Promise<P> }` as the second handler
// argument; the params are awaited inside the try so the handler reads them from `ctx.params`.
export function authedRouteWithParams<P>(
  opts: AuthedRouteOptions,
  handler: (ctx: AuthedCtxWithParams<P>) => Promise<NextResponse>,
) {
  return async (request: NextRequest, segmentData: { params: Promise<P> }): Promise<NextResponse> => {
    const gate = await authGate(opts)
    if (!gate.ok) return gate.res
    try {
      const [isPro, params] = await Promise.all([
        getCachedVerifiedProAccess(gate.userId),
        segmentData.params,
      ])
      return await handler({ userId: gate.userId, isPro, request, params })
    } catch (err) {
      return fail500(err, gate.userId)
    }
  }
}

/** Redirect from a route handler — prefer over raw `NextResponse.redirect`. */
export function apiRedirect(url: string | URL, status?: number): NextResponse {
  return NextResponse.redirect(url, status)
}

