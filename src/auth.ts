import NextAuth, { type User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import type { AdapterUser } from '@auth/core/adapters'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { authConfig } from '@/auth.config'
import { emailVerificationEnabled } from '@/lib/emails/verification'

interface AuthorizedUser {
  id: string
  email: string
  name: string | null
  image: string | null
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: AdapterUser | User }): Promise<JWT | null> {
      if (user) token.id = user.id
      if (token.id) {
        const exists = await prisma.user.findUnique({ where: { id: token.id as string }, select: { id: true } })
        if (!exists) {
          console.warn('[jwt] user not found by token.id, invalidating session:', token.id)
          return null
        }
      }
      return token
    },
  },
  ...authConfig,
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

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          select: { id: true, email: true, name: true, image: true, password: true, emailVerified: true },
        })

        if (!user?.password) return null

        const isValid = await bcrypt.compare(credentials.password as string, user.password)
        if (!isValid) return null

        if (emailVerificationEnabled() && !user.emailVerified) return null

        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),
  ],
})
