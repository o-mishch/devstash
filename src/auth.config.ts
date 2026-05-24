import type { NextAuthConfig, Session } from 'next-auth'
import type { NextRequest } from 'next/server'
import GitHub from 'next-auth/providers/github'
import Credentials from 'next-auth/providers/credentials'

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
      const isDashboard = nextUrl.pathname.startsWith('/dashboard')
      const isAuthPage =
        nextUrl.pathname === '/sign-in' || nextUrl.pathname === '/register'

      if (isDashboard) return isLoggedIn
      if (isAuthPage && isLoggedIn) {
        return Response.redirect(new URL('/dashboard', nextUrl))
      }
      return true
    },
  },
}
