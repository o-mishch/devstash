/** Idle window before jwt refresh invalidates the session (seconds). Single source of truth — consumed by auth.ts jwt(). */
export const SESSION_IDLE_TIMEOUT_SEC = 30 * 60

export interface SessionActivityToken {
  lastActiveAt?: number
}

/** Returns updated activity timestamp, or null when the idle window has elapsed. */
export function applySessionActivity(
  token: SessionActivityToken,
  isSignIn: boolean,
  now: number = Date.now(),
): { lastActiveAt: number } | null {
  if (isSignIn) {
    return { lastActiveAt: now }
  }
  if (typeof token.lastActiveAt !== 'number') {
    // Legacy session issued before idle tracking: seed `lastActiveAt` instead of invalidating, so a
    // deploy doesn't force-log-out everyone at once. It gets one fresh idle window; every refresh
    // after this writes the field, so the timeout enforces normally from here on.
    return { lastActiveAt: now }
  }
  const idleMs = SESSION_IDLE_TIMEOUT_SEC * 1000
  if (now - token.lastActiveAt > idleMs) {
    return null
  }
  return { lastActiveAt: now }
}
