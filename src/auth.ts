import NextAuth, { type Session, type User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import type { AdapterUser } from '@auth/core/adapters'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { authConfig } from '@/auth.config'

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
    jwt({ token, user }: { token: JWT; user?: AdapterUser | User }): JWT {
      if (user) token.id = user.id
      return token
    },
    session({ session, token }: { session: Session; token: JWT }): Session {
      session.user.id = token.id as string
      return session
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
        })

        if (!user?.password) return null

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!isValid) return null

        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),
  ],
})
