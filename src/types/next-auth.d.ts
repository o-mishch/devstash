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
  }
}
