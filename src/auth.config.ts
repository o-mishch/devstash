import type { NextAuthConfig, Session, User } from 'next-auth'
import type { AdapterUser } from 'next-auth/adapters'
import type { JWT } from 'next-auth/jwt'
import { NextResponse, type NextRequest } from 'next/server'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'
import { applySessionActivity } from '@/lib/auth/session-idle'
import { proGateFeatureForPath } from '@/lib/utils/pro-gate'

export const BCRYPT_ROUNDS = 12

interface AuthorizedParams {
  auth: Session | null
  request: NextRequest
}

interface JwtParams {
  token: JWT
  user?: User | AdapterUser
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  pages: {
    signIn: '/sign-in',
  },
  providers: [
    GitHub,
    Google,
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      // Actual validation is done in auth.ts (bcrypt can't run on the Edge)
      authorize: () => null,
    }),
  ],
  callbacks: {
    // Runs in the proxy (proxy.ts) — the route gate. Its job here is to INVALIDATE on idle:
    // returning null empties the session so `authorized` redirects protected routes to /sign-in.
    // The lastActiveAt refresh below keeps the decoded token consistent within this request, but
    // the proxy does not configure session rotation (no updateAge), so it does not durably persist
    // a fresh timestamp — auth.ts (node instance) owns the durable lastActiveAt refresh via its
    // updateAge-driven cookie rotation, and overrides jwt with a richer DB-backed version. This
    // edge copy only affects the proxy instance and is intentionally a safe subset of auth.ts.
    // It deliberately does NOT log the invalidation (unlike auth.ts, which logs it on the node
    // path): importing the server-only Pino logger here would pull Node-only code into the
    // proxy/middleware bundle, breaking this file's edge-safe contract (see the bcrypt note above).
    jwt({ token, user }: JwtParams): JWT | null {
      const activity = applySessionActivity(token, Boolean(user))
      if (!activity) return null
      token.lastActiveAt = activity.lastActiveAt
      return token
    },
    authorized({ auth, request: { nextUrl } }: AuthorizedParams) {
      const isLoggedIn = !!auth?.user?.id
      const isProtected =
        nextUrl.pathname.startsWith('/dashboard') ||
        nextUrl.pathname.startsWith('/profile') ||
        nextUrl.pathname.startsWith('/settings') ||
        nextUrl.pathname.startsWith('/collections') ||
        nextUrl.pathname.startsWith('/favorites') ||
        nextUrl.pathname.startsWith('/items')

      if (isProtected && !isLoggedIn) return false

      // Redirect non-Pro users away from Pro-only pages at the edge — before any render or
      // loading.tsx — so a direct URL visit lands on /upgrade with no flash of the gated page.
      // `auth.user.isPro` comes from the decoded JWT (stamped in auth.ts). Only gates a signed-in
      // user; a signed-out one on a protected Pro path was already denied above.
      if (isLoggedIn) {
        const gate = proGateFeatureForPath(nextUrl.pathname)
        if (gate && !auth?.user?.isPro) {
          const url = new URL('/upgrade', nextUrl)
          url.searchParams.set('gate', gate)
          return NextResponse.redirect(url)
        }
      }

      if (isProtected) return isLoggedIn
      // Auth pages handle "already signed in" via server-side session (DB-validated).
      // Middleware only decodes the JWT and cannot detect deleted users — redirecting
      // here caused an infinite loop with stale cookies.
      return true
    },
    // session callback runs in the middleware (proxy.ts) context, which is what
    // auth() in server components reads. token.sub is set automatically by Auth.js
    // to user.id on sign-in for both Credentials and OAuth providers.
    session({ session, token }: { session: Session; token: JWT }): Session {
      const userId = (token.id ?? token.sub) as string | undefined
      if (userId) session.user.id = userId
      // Surface the JWT's Pro flag on the edge session so `authorized` can gate Pro-only routes
      // without a DB call. The Node session callback (auth.ts) overrides this with a fresh
      // Redis-backed read for server components; here we only have the token.
      session.user.isPro = token.isPro ?? false
      return session
    },
  },
}
