import 'server-only'

import { PrismaClient } from '@/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'prisma' })

function createPrismaClient() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL })
  return new PrismaClient({ adapter }).$extends({
    query: {
      // `verification_tokens` is DEPRECATED — all auth tokens now live in Redis (see
      // `src/lib/auth/tokens.ts`). The table is kept only for the NextAuth PrismaAdapter contract and
      // is never used by our flows. Warn loudly if anything ever reads/writes it (e.g. an
      // accidentally-enabled Email/magic-link provider) so the regression is caught.
      verificationToken: {
        $allOperations({ operation, args, query }) {
          log.warn({ operation }, 'deprecated verification_tokens access — auth tokens were migrated to Redis')
          return query(args)
        },
      },
    },
  })
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>

// Reuse client across hot reloads in development
const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient }
export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
