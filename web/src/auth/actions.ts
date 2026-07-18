import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import type { AnyRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { sessionQueryOptions } from './session'
import { sanitizeRelative } from './redirect'
import { setAuthenticating, setLoggingOut } from './transition-state'

interface AuthActions {
  onAuthenticated: () => Promise<void>
  onLoggedOut: () => Promise<void>
}

/**
 * Drop every query outside the `['auth']` subtree.
 *
 * Domain query keys are operation-scoped (`[{ _id: 'listItems' }]`) and carry no user
 * identity, so without this one user's items survive a logout for the full `gcTime` and
 * render — fresh, inside `staleTime`, so nothing even refetches — to the next user who
 * signs in in the same tab. Every endpoint IDOR-scopes independently, but that does not
 * help here: the leak is client-side cache reuse, not a server authorization bypass.
 *
 * `['auth']` is preserved deliberately rather than using `queryClient.clear()`, because both
 * callers of `applyAuthChange` seed the session to a known `null` immediately BEFORE it runs
 * (`onLoggedOut` below; the 401 interceptor in `lib/api/client.ts`). Clearing here would
 * delete that seed, and the protected subtree would then unmount against an `undefined`
 * session — an unresolved query that refetches — instead of the settled `null` the caller
 * just established. Login does not come through here at all: `onAuthenticated` clears the
 * whole cache itself, for the separate reason documented on it.
 */
function removeNonAuthQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
}

/**
 * Apply an auth change (login / logout / password change).
 *
 * 1. Drop the auth cache WITHOUT refetching (`refetchType: 'none'`) — the caller
 *    already knows the new state, and a refetch would race the redirect.
 * 2. `router.invalidate({ forcePending: true })` re-runs every `beforeLoad` AND
 *    unmounts the protected subtree first, so no component keeps rendering/querying
 *    against a session that just went away (a plain `invalidate()` leaves it mounted).
 * 3. Only THEN drop the previous user's server state (see `removeNonAuthQueries`).
 *
 * Step 3 is last on purpose. Removing a query that a mounted component still observes does
 * not just delete it: the next render rebuilds the entry and refetches it. Dropping the data
 * while `/dashboard` was still mounted therefore bought a burst of doomed requests and a
 * skeleton flash on the way out. After `forcePending` there are no observers left to notice.
 */
export async function applyAuthChange(queryClient: QueryClient, router: AnyRouter): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['auth'], refetchType: 'none' })
  await router.invalidate({ forcePending: true })
  removeNonAuthQueries(queryClient)
}

/**
 * Cache + router transitions for auth changes. Cache mutations live here (in the
 * hook), never in components — components call these and get typed functions back.
 */
export function useAuthActions(): AuthActions {
  const queryClient = useQueryClient()
  const router = useRouter()

  // Login / account-link succeeded. The endpoint set the session cookie server-side but returns
  // no body, so the client has to go ask who it now is.
  const onAuthenticated = async (): Promise<void> => {
    setAuthenticating(true)
    try {
      // Everything, including `['auth']`. Two reasons, and both matter:
      //  - any previous user's domain data must not survive into this session (see
      //    `removeNonAuthQueries` — the keys carry no user identity);
      //  - the pre-login session entry is a stale `null` (the sign-in guard's own 401 seeded
      //    it), and `ensureQueryData` never refetches a cache entry that isn't `undefined`, so
      //    leaving it would bounce the user we just authenticated straight back to sign-in.
      queryClient.clear()
      // `ensureQueryData`, not `refetchQueries`: this has to work on a COLD cache too. The
      // account-link landing arrives by full-page redirect from the OAuth callback, so its
      // QueryClient is brand new and holds no session query — `refetchQueries` has nothing to
      // refetch there, resolves silently, and the caller's recovery path could never fire.
      // Against an empty cache this always issues a real GET: a 5xx/network blip THROWS (which
      // is what the caller catches to say "you're signed in, please refresh"), while a 401
      // resolves to null and lets the `_app` guard redirect.
      await queryClient.ensureQueryData(sessionQueryOptions)
      await router.invalidate({ forcePending: true })
    } finally {
      setAuthenticating(false)
    }
  }

  // Logout / session death. Null the session first so the protected subtree unmounts
  // against a known logged-out state, then apply the shared invalidate/forcePending.
  const onLoggedOut = async (): Promise<void> => {
    setLoggingOut(true)
    try {
      queryClient.setQueryData(sessionQueryOptions.queryKey, null)
      await applyAuthChange(queryClient, router)
    } finally {
      setLoggingOut(false)
    }
  }

  return { onAuthenticated, onLoggedOut }
}

/**
 * Post-authentication hand-off: resolve the new session, then navigate.
 *
 * One owner for the recovery path, because getting it wrong is subtle — the cookie is
 * already set server-side when this runs, so a failed session GET must surface as "you
 * are signed in, reload" rather than as a failed sign-in. Duplicating this per auth page
 * is how the two copies drift.
 */
export function useAuthenticatedRedirect(): (
  target: string | undefined,
  failureMessage: string,
) => Promise<void> {
  const { onAuthenticated } = useAuthActions()
  const router = useRouter()

  return async (target, failureMessage) => {
    try {
      await onAuthenticated()
    } catch {
      // Cookie is set server-side but the follow-up session GET failed (network/5xx).
      // Don't strand the form — a refresh re-runs the session query from the cookie.
      toast.error(failureMessage)
      return
    }
    // `href` (not `to`) preserves the target's query string and hash. Re-sanitize AT the sink
    // rather than trusting every caller to have done so — a future call site that forgets would
    // otherwise compile clean and ship an open redirect (mirrors `redirectIfSignedIn` in
    // session.ts). `sanitizeRelative` is idempotent, so already-clean callers are unaffected.
    await router.navigate({ href: sanitizeRelative(target) })
  }
}
