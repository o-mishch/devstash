import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const KEEP_EMAIL = 'demo@devstash.io'

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  const keeper = await prisma.user.findUnique({
    where: { email: KEEP_EMAIL },
    select: { id: true },
  })

  if (!keeper) {
    console.error(`✗ ${KEEP_EMAIL} not found — aborting`)
    process.exit(1)
  }

  const targets = await prisma.user.findMany({
    where: { id: { not: keeper.id } },
    select: { id: true, email: true },
  })

  if (targets.length === 0) {
    console.log('No other users to delete.')
    return
  }

  const emails = targets.map((u) => u.email)

  console.log(`Deleting ${targets.length} user(s):`)
  targets.forEach((u) => console.log(`  - ${u.email}`))

  // Deleting users cascades to: accounts, sessions, items, collections,
  // item_types, item_collections, and item tags (all have ON DELETE CASCADE).
  // verification_tokens use email as identifier (no userId FK) so deleted separately.
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: { in: emails } } }),
    prisma.user.deleteMany({ where: { id: { not: keeper.id } } }),
  ])

  console.log(`✓ Done — kept ${KEEP_EMAIL}`)
}

main()
  .catch((err) => {
    console.error('✗ Purge failed:', err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
