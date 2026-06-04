import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const DEMO_EMAIL = 'demo@devstash.io'
const KEEP_PER_TYPE = 10
const DELETE_BATCH = 1000

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  const demoUser = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true, email: true },
  })

  if (!demoUser) {
    console.error(`✗ ${DEMO_EMAIL} not found — aborting`)
    process.exit(1)
  }

  console.log(`Target user: ${demoUser.email} (${demoUser.id})`)

  const totalBefore = await prisma.item.count({ where: { userId: demoUser.id } })
  console.log(`Items before: ${totalBefore.toLocaleString()}\n`)

  if (totalBefore === 0) {
    console.log('Nothing to delete.')
    return
  }

  // Collect IDs to keep: up to KEEP_PER_TYPE per item type, preferring pinned > favorite > newest
  const itemTypes = await prisma.itemType.findMany({ select: { id: true, name: true } })
  const keepIds: string[] = []

  console.log(`Selecting ${KEEP_PER_TYPE} items to keep per type:`)
  for (const type of itemTypes) {
    const keepers = await prisma.item.findMany({
      where: { userId: demoUser.id, itemTypeId: type.id },
      orderBy: [{ isPinned: 'desc' }, { isFavorite: 'desc' }, { createdAt: 'desc' }],
      take: KEEP_PER_TYPE,
      select: { id: true },
    })
    keepIds.push(...keepers.map((i) => i.id))
    console.log(`  ${type.name}: keeping ${keepers.length}`)
  }

  console.log(`\nKeeping ${keepIds.length} items total`)

  const toDeleteCount = await prisma.item.count({
    where: { userId: demoUser.id, id: { notIn: keepIds } },
  })
  console.log(`Deleting ${toDeleteCount.toLocaleString()} items in batches of ${DELETE_BATCH}...\n`)

  let deleted = 0
  while (true) {
    const batch = await prisma.item.findMany({
      where: { userId: demoUser.id, id: { notIn: keepIds } },
      select: { id: true },
      take: DELETE_BATCH,
    })
    if (batch.length === 0) break

    const result = await prisma.item.deleteMany({
      where: { id: { in: batch.map((i) => i.id) } },
    })
    deleted += result.count
    process.stdout.write(`\r  Deleted ${deleted.toLocaleString()} / ${toDeleteCount.toLocaleString()}`)
  }

  console.log(`\n\n✓ Done — deleted ${deleted.toLocaleString()} items`)
  console.log(`  Neon autovacuum will reclaim disk space within a few minutes.`)

  const totalAfter = await prisma.item.count({ where: { userId: demoUser.id } })
  console.log(`\nItems after: ${totalAfter.toLocaleString()} (was ${totalBefore.toLocaleString()})`)
}

main()
  .catch((err) => {
    console.error('✗ Script failed:', err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
