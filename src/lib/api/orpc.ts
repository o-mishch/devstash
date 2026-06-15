import 'server-only'
import { implement, ORPCError } from '@orpc/server'
import type { ResponseHeadersPluginContext } from '@orpc/server/plugins'
import { contract } from './contract'
import { ErrorMessage } from './error-messages'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'

// Initial handler context. The ResponseHeadersPlugin injects `resHeaders` so handlers and
// middleware can set response headers (e.g. `Retry-After` on a 429 from `enforceRateLimit`).
export type InitialContext = ResponseHeadersPluginContext

export interface AuthedContext extends InitialContext {
  userId: string
  isPro: boolean
}

// Public implementer — procedures that do not require a session.
export const pub = implement(contract).$context<InitialContext>()

// Authenticated implementer — resolves the session in middleware and injects an IDOR-safe
// context. `userId` always comes from the session, never from procedure input.
export const authed = pub.use(async ({ next }) => {
  const session = await getCachedSession()
  if (!session?.user?.id) {
    throw new ORPCError('UNAUTHORIZED', { message: ErrorMessage.NOT_AUTHENTICATED })
  }
  const isPro = await getCachedVerifiedProAccess(session.user.id)
  return next({ context: { userId: session.user.id, isPro } satisfies AuthedContext })
})
