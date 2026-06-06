import NextAuth, { type User, type Account } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import type { AdapterUser } from 'next-auth/adapters'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { cookies } from 'next/headers'
import Credentials from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import { authConfig } from '@/auth.config'
import { emailVerificationEnabled } from '@/lib/emails/verification'
import {
  createPendingLink,
  getLinkIntent,
  deleteLinkIntent,
  type PendingLinkData,
} from '@/lib/pending-link'
import {
  getUserSessionInfo,
  getUserWithOAuthConflict,
  getUserById,
  getProviderAccount,
} from '@/lib/db/users'
import { SUPPORTED_OAUTH_PROVIDERS } from '@/lib/utils/constants'
import { validateUserPassword } from '@/lib/auth-service'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth')

export const LINK_INTENT_COOKIE = 'devstash_link_token'

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

interface JwtParams {
  token: JWT
  user?: AdapterUser | User
  account?: Account | null
}

function buildPendingLinkData(email: string, userEmail: string | null | undefined, account: Account): PendingLinkData {
  return {
    email,
    providerEmail: userEmail ?? null,
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
  } as PendingLinkData
}

async function handleLinkIntent(user: User | AdapterUser, account: Account): Promise<string | boolean | null> {
  const cookieStore = await cookies()
  const intentToken = cookieStore.get(LINK_INTENT_COOKIE)?.value

  if (!intentToken) return null

  const intent = await getLinkIntent(intentToken)
  await deleteLinkIntent(intentToken)

  if (!intent) return null

  const targetUser = await getUserById(intent.userId)
  if (!targetUser) return true // safety: fall through to normal flow

  // Check if this OAuth identity is already linked somewhere
  const existing = await getProviderAccount(account.provider, account.providerAccountId)
  if (existing) {
    // Already linked to this user — nothing to do
    if (existing.userId === intent.userId) {
      return '/profile?toast=already_linked'
    }
    // Linked to a different DevStash account
    return '/profile?toast=taken'
  }

  // Store pending link keyed by the target user's primary email
  const token = await createPendingLink(buildPendingLinkData(targetUser.email, user.email, account))

  if (!token) return true
  return `/link-account?token=${token}`
}

async function handleOAuthConflict(user: User | AdapterUser, account: Account): Promise<string | boolean> {
  if (!user.email) return true

  const existingUser = await getUserWithOAuthConflict(user.email, account.provider)
  if (!existingUser) return true

  const token = await createPendingLink(buildPendingLinkData(existingUser.email, user.email, account))

  if (!token) return true
  return `/link-account?token=${token}`
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, account }: JwtParams): Promise<JWT | null> {
      if (user) token.id = user.id
      if (token.id) {
        try {
          const dbUser = await getUserSessionInfo(token.id as string)
          if (!dbUser) {
            log.warn(`user not found by token.id, invalidating session: ${token.id}`)
            return null
          }
          token.isPro = dbUser.isPro ?? false
          // Last 8 chars of the bcrypt hash — changes on every password rotation
          const pwFingerprint = dbUser.password?.slice(-8) ?? ''
          if (user) {
            // Sign-in: snapshot the current fingerprint
            token.pwHash = pwFingerprint
          } else if (token.pwHash !== undefined && token.pwHash !== pwFingerprint) {
            const hadPassword = token.pwHash !== ''
            const hasPassword = pwFingerprint !== ''
            if (hadPassword && hasPassword) {
              // Password was rotated — force re-login so the old session can't be reused
              return null
            }
            // Password was added or removed — sync the fingerprint without invalidating
            token.pwHash = pwFingerprint
          }
        } catch (error) {
          log.error('DB error validating session (preserving token):', error)
          // Do not invalidate session or crash NextAuth on transient DB errors (e.g., Neon cold starts)
        }
      }

      // Backfill Account.email for OAuth sign-ins handled by PrismaAdapter
      if (account && account.provider !== 'credentials' && user?.email) {
        prisma.account
          .updateMany({
            where: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              email: null,
            },
            data: { email: user.email },
          })
          .catch(() => {})
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.isPro = token.isPro as boolean
      }
      return session
    },
    async signIn({ user, account }: SignInParams): Promise<boolean | string> {
      // Only intercept supported OAuth sign-ins
      if (
        !account?.provider ||
        !SUPPORTED_OAUTH_PROVIDERS.includes(account.provider as (typeof SUPPORTED_OAUTH_PROVIDERS)[number])
      ) return true

      // ── Link-intent path ──────────────────────────────────────────────────
      // User is already signed in and clicked "Add account" from the profile page.
      // A short-lived cookie carries a Redis token pointing to their userId.
      const intentResult = await handleLinkIntent(user, account)
      if (intentResult !== null) return intentResult

      // ── Conflict-detection path ───────────────────────────────────────────
      // No link intent. Check if an existing DevStash account shares this email
      // but hasn't linked this provider yet.
      return handleOAuthConflict(user, account)
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
