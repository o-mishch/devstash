import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import { client } from '@/client/client.gen'
import { sessionQueryOptions } from '@/auth/session'
import { applyAuthChange } from '@/auth/actions'
import { isAuthTransitionInFlight, setLoggingOut } from '@/auth/transition-state'

// `client` is a module singleton, so re-registering (dev HMR, tests, any repeat
// getRouter()) would STACK interceptors, each bound to a dead queryClient/router.
// Eject the prior one so only the latest closure is live.
let interceptorId: number | undefined

/**
 * Install the runtime 401 response interceptor. This is LOAD-BEARING:
 * `ensureQueryData` ignores `staleTime` and returns stale cache, so a route's
 * `beforeLoad` cannot self-heal a session that expires mid-session. Only a live
 * response interceptor can — when any authed request comes back 401, we null the
 * session and force a pending re-validation (which redirects to sign-in).
 *
 * Scope rules:
 *  - 401 ONLY. A 403 is authorized-but-forbidden and must NOT log the user out.
 *  - Skip `/auth/session` itself — its queryFn already maps 401 → null, and letting
 *    it re-trigger the logout flow would double-invalidate on every logged-out load.
 *  - Skip while an auth transition owns the session (see `isAuthTransitionInFlight`),
 *    which also dedups concurrent/late 401s: the first one sets the flag, so a second
 *    in-flight request's 401 cannot fire a second `forcePending` invalidate.
 *
 * INVARIANT this relies on: no PUBLIC auth flow (login/register/reset/link) ever returns
 * 401 — they use 400/403/422/503 — so a 401 here always means an expired *authed*
 * session. If a future endpoint returns 401 for a credential failure, exclude it here too.
 */
export function installApiInterceptors(queryClient: QueryClient, router: AnyRouter): void {
  if (interceptorId !== undefined) {
    client.interceptors.response.eject(interceptorId)
  }
  interceptorId = client.interceptors.response.use((response) => {
    if (response.status !== 401 || isAuthTransitionInFlight()) return response

    // Compare on the parsed pathname so a query string on the session request can't
    // defeat the skip. Fail CLOSED when the URL won't parse: `Response.url` is the empty
    // string for a response not produced by an HTTP fetch, and '' matches no path — so
    // treating an unparseable URL as "not the session request" would turn the session's
    // own 401 into a full logout on every logged-out page load, the exact double-
    // invalidate this skip exists to prevent. If we can't prove it isn't the session
    // request, don't act on it.
    if (!URL.canParse(response.url)) return response
    if (new URL(response.url).pathname.endsWith('/auth/session')) return response

    setLoggingOut(true)
    // Seed the known terminal state; `applyAuthChange` then drops the dead session's
    // domain data and unmounts the subtree against this null.
    queryClient.setQueryData(sessionQueryOptions.queryKey, null)
    void (async (): Promise<void> => {
      try {
        await applyAuthChange(queryClient, router)
      } catch (error) {
        // The session is already seeded to null and the `_app` guard still redirects, so a
        // failed invalidation is non-fatal — swallow it rather than escape as an unhandled
        // rejection (the two sibling transitions handle their failure edge in their caller).
        console.error('Failed to apply auth change after 401:', error)
      } finally {
        setLoggingOut(false)
      }
    })()
    return response
  })
}
