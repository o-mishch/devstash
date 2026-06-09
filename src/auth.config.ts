import type { NextAuthConfig, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'

export const BCRYPT_ROUNDS = 12

interface AuthorizedParams {
  auth: Session | null
  request: NextRequest
}

export const authConfig: NextAuthConfig = {
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
    authorized({ auth, request: { nextUrl } }: AuthorizedParams) {
      const isLoggedIn = !!auth?.user?.id
      const isProtected =
        nextUrl.pathname.startsWith('/dashboard') ||
        nextUrl.pathname.startsWith('/profile') ||
        nextUrl.pathname.startsWith('/settings') ||
        nextUrl.pathname.startsWith('/collections') ||
        nextUrl.pathname.startsWith('/favorites') ||
        nextUrl.pathname.startsWith('/items')

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
      return session
    },
  },
}
