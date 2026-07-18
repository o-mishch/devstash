/**
 * Interlocks for an in-flight auth transition (login / account-link / logout).
 *
 * These live in a leaf module rather than on either side that uses them because a
 * direct dependency between those two is a cycle: the API client's 401 interceptor
 * must call `applyAuthChange` from `@/auth/actions`, and `actions` must flip these
 * flags. The cycle resolved only by accident — neither module touches the other's
 * bindings at module-evaluation time — so any future top-level call would have
 * surfaced it as a TDZ error, with HMR ordering hitting it before prod did.
 */

let authenticating = false
let loggingOut = false

export function setAuthenticating(value: boolean): void {
  authenticating = value
}

export function setLoggingOut(value: boolean): void {
  loggingOut = value
}

/**
 * True while an auth transition owns the session. The 401 interceptor skips its
 * logout path in this window: a stale 401 from a request issued under the PREVIOUS
 * session must not hijack a login that just succeeded.
 *
 * Dropping a genuine 401 here is safe rather than merely tolerable, and that is what
 * makes the window sound: both transitions end by resolving the session against the
 * server (`ensureQueryData(sessionQueryOptions)` against a cleared cache on login, a
 * known `null` on logout) and then running `router.invalidate({ forcePending: true })`.
 * If the session really is dead, that GET returns null and the `_app` guard redirects —
 * the interceptor is not the only thing that can notice. Keep this window as narrow as
 * the transition itself.
 */
export function isAuthTransitionInFlight(): boolean {
  return authenticating || loggingOut
}
