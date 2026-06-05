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
  session: {
    maxAge: 15 * 60, // 15 minutes
  },
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
      const isLoggedIn = !!auth?.user
      const isProtected =
        nextUrl.pathname.startsWith('/dashboard') ||
        nextUrl.pathname.startsWith('/profile') ||
        nextUrl.pathname.startsWith('/settings') ||
        nextUrl.pathname.startsWith('/collections') ||
        nextUrl.pathname.startsWith('/favorites') ||
        nextUrl.pathname.startsWith('/items')
      const isAuthPage =
        nextUrl.pathname === '/sign-in' || nextUrl.pathname === '/register'

      if (isProtected) return isLoggedIn
      if (isAuthPage && isLoggedIn) {
        return Response.redirect(new URL('/dashboard', nextUrl))
      }
      return true
    },
    // session callback runs in the middleware (proxy.ts) context, which is what
    // auth() in server components reads. token.sub is set automatically by Auth.js
    // to user.id on sign-in for both Credentials and OAuth providers.
    session({ session, token }: { session: Session; token: JWT }): Session {
      if (token.sub) session.user.id = token.sub
      return session
    },
  },
}
