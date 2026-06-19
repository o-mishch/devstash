import { describe, it, expect } from 'vitest'
import { applySessionActivity, SESSION_IDLE_TIMEOUT_SEC, type SessionActivityToken } from './session-idle'

describe('applySessionActivity', () => {
  const now = 1_700_000_000_000
  const idleMs = SESSION_IDLE_TIMEOUT_SEC * 1000

  it('sets lastActiveAt on sign-in', () => {
    expect(applySessionActivity({}, true, now)).toEqual({ lastActiveAt: now })
  })

  it('refreshes lastActiveAt when still within the idle window', () => {
    const token = { lastActiveAt: now - idleMs + 1000 }
    expect(applySessionActivity(token, false, now)).toEqual({ lastActiveAt: now })
  })

  it('returns null when idle timeout exceeded', () => {
    const token = { lastActiveAt: now - idleMs - 1 }
    expect(applySessionActivity(token, false, now)).toBeNull()
  })

  it('seeds lastActiveAt (one-time rollout grace) when it is missing on refresh', () => {
    expect(applySessionActivity({}, false, now)).toEqual({ lastActiveAt: now })
  })
})

describe('auth.ts jwt() idle gate', () => {
  const now = 1_700_000_000_000
  const idleMs = SESSION_IDLE_TIMEOUT_SEC * 1000

  /** Mirrors auth.ts jwt(): applySessionActivity(token, Boolean(user)); null → invalidate session. */
  function jwtIdleLastActiveAt(token: SessionActivityToken, user: object | undefined): number | null {
    return applySessionActivity(token, Boolean(user), now)?.lastActiveAt ?? null
  }

  it('sets lastActiveAt on sign-in (user present)', () => {
    expect(jwtIdleLastActiveAt({}, { id: 'u1' })).toBe(now)
  })

  it('seeds (does not invalidate) legacy tokens missing lastActiveAt on refresh (user absent)', () => {
    expect(jwtIdleLastActiveAt({}, undefined)).toBe(now)
  })

  it('invalidates when idle window elapsed on refresh', () => {
    expect(jwtIdleLastActiveAt({ lastActiveAt: now - idleMs - 1 }, undefined)).toBeNull()
  })

  it('refreshes lastActiveAt when still within idle window on refresh', () => {
    expect(jwtIdleLastActiveAt({ lastActiveAt: now - 1000 }, undefined)).toBe(now)
  })
})
