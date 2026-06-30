import 'server-only'

import { PrismaClient } from '@/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { createLocalDbAdapter } from '@/lib/infra/db-local'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'prisma' })

function createPrismaClient() {
  // In local dev (DB_LOCAL=1) use the standard node-postgres adapter so interactive
  // transactions work against in-cluster Postgres; otherwise the production Neon
  // serverless adapter, unchanged.
  const adapter = createLocalDbAdapter() ?? new PrismaNeon({ connectionString: process.env.DATABASE_URL })
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

// The interactive-transaction client this extended `prisma` yields inside `$transaction(async (tx) => …)`.
// Derived from the extended client (not the base `Prisma.TransactionClient`) so a helper accepting `tx`
// — e.g. `createItem(userId, data, tx)` — type-checks against both the callback `tx` and the module
// `prisma` default. Equivalent to the extended client minus the top-level-only methods.
export type PrismaTransactionClient = Omit<
  ExtendedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

// Reuse client across hot reloads in development
const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient }
export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
