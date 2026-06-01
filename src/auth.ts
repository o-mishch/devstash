import NextAuth, { type User, type Account } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import type { AdapterUser } from 'next-auth/adapters'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import { authConfig } from '@/auth.config'
import { emailVerificationEnabled } from '@/lib/emails/verification'
import { createPendingLink, PendingLinkData } from '@/lib/pending-link'
import { getUserSessionInfo, getUserWithGithubAccount } from '@/lib/db/users'
import { validateUserPassword } from '@/lib/auth-service'

interface AuthorizedUser {
  id: string
  email: string
  name: string | null
  image: string | null
}

interface SignInParams {
  user: User | AdapterUser
  account?: Account | null
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }: { token: JWT; user?: AdapterUser | User }): Promise<JWT | null> {
      if (user) token.id = user.id
      if (token.id) {
        const dbUser = await getUserSessionInfo(token.id as string)
        if (!dbUser) {
          console.warn('[jwt] user not found by token.id, invalidating session:', token.id)
          return null
        }
        // Last 8 chars of the bcrypt hash change on every password update
        const pwFingerprint = dbUser.password?.slice(-8) ?? ''
        if (user) {
          // Sign-in: snapshot the current password fingerprint
          token.pwHash = pwFingerprint
        } else if (token.pwHash !== undefined && token.pwHash !== pwFingerprint) {
          // Refresh: password was rotated after this token was issued — invalidate
          return null
        }
      }
      return token
    },
    async signIn({ user, account }: SignInParams): Promise<boolean | string> {
      // Only intercept GitHub OAuth sign-ins
      if (account?.provider !== 'github' || !user.email) return true

      // Check if there's an existing user with this email but no linked GitHub account
      const existingUser = await getUserWithGithubAccount(user.email)

      // No conflict: new user or GitHub already linked
      if (!existingUser || existingUser.accounts.length > 0) return true

      // Conflict: credentials-only account exists — store pending link and redirect to consent page
      const token = await createPendingLink({
        email: user.email,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        type: account.type,
        access_token: account.access_token ?? null,
        refresh_token: account.refresh_token ?? null,
        expires_at: account.expires_at ?? null,
        token_type: account.token_type ?? null,
        scope: account.scope ?? null,
        id_token: account.id_token ?? null,
        session_state: typeof account.session_state === 'string' ? account.session_state : null,
      } as PendingLinkData)

      // Redis unavailable — proceed with normal OAuth flow; NextAuth will surface OAuthAccountNotLinked
      if (!token) return true

      return `/link-account?token=${token}`
    },
  },
  providers: [
    // Filter out the edge-safe placeholder so we don't get a duplicate form
    ...authConfig.providers.filter((p) => {
      const id = typeof p === 'function' ? p({}).id : p.id
      return id !== 'credentials'
    }),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials): Promise<AuthorizedUser | null> {
        if (!credentials?.email || !credentials?.password) return null

        const user = await validateUserPassword(credentials.email as string, credentials.password as string)

        if (!user) return null

        if (emailVerificationEnabled() && !user.emailVerified) return null

        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),
  ],
})
