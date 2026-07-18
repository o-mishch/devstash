import { queryOptions, useQuery } from '@tanstack/react-query'
import type { QueryClient, UseQueryResult } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { authSession } from '@/client'
import type { SessionOutputBody } from '@/client'
import { redirectSearchSchema, sanitizeRelative } from './redirect'

export type Session = SessionOutputBody
export type SessionUser = SessionOutputBody['user']

/** The `beforeLoad` arguments `authEntryRoute` reads (a subset of the router's). */
interface AuthEntryBeforeLoad {
  context: { queryClient: QueryClient }
  search: { redirect?: string | undefined }
  cause: string
}

/**
 * The session is the single source of truth for auth state (TanStack Query, not
 * Zustand). `GET /auth/session` resolves to the session or `null`:
 *  - 401 (no/expired session) → `null` (a clean logged-out state).
 *  - network error / 5xx → THROWS, so a transient blip hits an errorComponent
 *    rather than being mistaken for a logout.
 */
export const sessionQueryOptions = queryOptions({
  queryKey: ['auth', 'session'] as const,
  queryFn: async ({ signal }): Promise<Session | null> => {
    const { data, response } = await authSession({ signal })
    // No response at all = a network failure → THROW (errorComponent, not a logout).
    if (!response) throw new Error('session request failed (network)')
    if (response.status === 401) return null
    if (!response.ok || !data) {
      throw new Error(`session request failed (${response.status})`)
    }
    return data
  },
  // staleTime inherits the QueryClient default (lib/query.ts) — one source of truth.
})

export function useSession(): UseQueryResult<Session | null> {
  return useQuery(sessionQueryOptions)
}

/**
 * Session for PUBLIC pages' "already signed in? redirect away" optimization. Unlike
 * the protected-subtree guard (which must throw so a network blip hits an error
 * boundary rather than a false redirect), a failed check here should never block the
 * auth form — treat an unreachable session endpoint as signed-out.
 */
async function resolveOptionalSession(queryClient: QueryClient): Promise<Session | null> {
  try {
    return await queryClient.ensureQueryData(sessionQueryOptions)
  } catch {
    return null
  }
}

/**
 * Shared `beforeLoad` guard for the PUBLIC auth entry pages (sign-in, register):
 * already signed in → bounce to the redirect target (or `/dashboard`). No-op on intent
 * preload (don't yank a user mid-hover) and on a failed session check (never block the
 * form). `cause` is the router's typed navigation cause, widened to `string` since we
 * only branch on `'preload'`.
 */
export async function redirectIfSignedIn(
  queryClient: QueryClient,
  target: string | undefined,
  cause: string,
): Promise<void> {
  if (cause === 'preload') return
  const session = await resolveOptionalSession(queryClient)
  // `href` (not `to`) preserves the target's query string and hash, which means it also
  // bypasses the router's type checks — so this is the one unguarded redirect sink in the
  // auth layer. Sanitize HERE rather than trusting every caller to have done it: the guard
  // is cheap and idempotent, and a future call site that forgets would otherwise compile
  // clean and ship an open redirect. `sanitizeRelative` returns the fallback for undefined.
  if (session) throw redirect({ href: sanitizeRelative(target) })
}

/**
 * The route options every PUBLIC auth entry page (sign-in, register) shares. Exported as
 * one object because the schema and the guard are a unit — the guard exists to bounce a
 * signed-in user to `search.redirect`, which only means anything if the schema parsed it.
 */
export const authEntryRoute = {
  validateSearch: redirectSearchSchema,
  beforeLoad: async ({ context, search, cause }: AuthEntryBeforeLoad): Promise<void> => {
    await redirectIfSignedIn(context.queryClient, search.redirect, cause)
  },
}
