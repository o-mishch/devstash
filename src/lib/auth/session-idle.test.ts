import { describe, it, expect, vi, afterEach } from 'vitest'
import { applySessionActivity, SESSION_IDLE_TIMEOUT_SEC, type SessionActivityToken } from './session-idle'
import { authConfig } from '@/auth.config'

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

describe('auth.config.ts (proxy) jwt() idle gate', () => {
  const now = 1_700_000_000_000
  const idleMs = SESSION_IDLE_TIMEOUT_SEC * 1000

  // Exercise the REAL proxy callback exported from auth.config.ts — not a re-implemented copy — so a
  // regression in the actual wiring (e.g. dropping the null-return) is caught. null → session
  // invalidated → `authorized` redirects protected routes to /sign-in. Fake timers drive the
  // production 2-arg `applySessionActivity(token, Boolean(user))` call (which defaults `now` to
  // `Date.now()`), so the test covers the exact code path the proxy runs, not a 3-arg test seam.
  const jwt = authConfig.callbacks!.jwt!

  afterEach(() => {
    vi.useRealTimers()
  })

  function runProxyJwt(token: SessionActivityToken, user?: object) {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    // The proxy jwt reads only `token` and whether `user` is present; NextAuth's wider param type
    // (account/profile/trigger) is irrelevant to the idle gate, so a narrowed arg is cast through.
    return jwt({ token, user } as unknown as Parameters<typeof jwt>[0])
  }

  it('invalidates the token (returns null) when the idle window has elapsed on refresh', async () => {
    expect(await runProxyJwt({ lastActiveAt: now - idleMs - 1 })).toBeNull()
  })

  it('refreshes lastActiveAt on the same token reference within the idle window on refresh', async () => {
    const token: SessionActivityToken = { lastActiveAt: now - 1000 }
    const result = await runProxyJwt(token)
    expect(result).toBe(token)
    expect(result).toEqual({ lastActiveAt: now })
  })

  it('seeds lastActiveAt on sign-in (user present)', async () => {
    expect(await runProxyJwt({}, { id: 'u1' })).toEqual({ lastActiveAt: now })
  })
})
