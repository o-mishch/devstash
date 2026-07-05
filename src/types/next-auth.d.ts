import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      /**
       * Display fallback when billing APIs are unavailable.
       * Never use for gating — use `getCachedVerifiedProAccess` from `@/lib/billing/access/pro-access-resolution`.
       */
      isPro: boolean
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    pwHash?: string
    lastActiveAt?: number
    email?: string
    /**
     * Pro access carried into the edge so `proxy.ts` can redirect Pro-only routes before any render.
     * Re-derived from the user row on every `jwt` callback run (as fresh as `email`). UX-only — the
     * real gate is `getCachedVerifiedProAccess` in the API/route layer; never trust this for access.
     */
    isPro?: boolean
  }
}
