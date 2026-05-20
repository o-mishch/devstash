import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  console.log('Testing database connection...\n')

  await prisma.$queryRaw`SELECT 1`
  console.log('✓ Connected to Neon PostgreSQL')

  // Item types
  const itemTypes = await prisma.itemType.findMany({ orderBy: { name: 'asc' } })
  console.log(`✓ Item types seeded: ${itemTypes.length}`)
  itemTypes.forEach((t) => console.log(`    ${t.color}  ${t.name}`))

  // Table counts
  const [users, items, collections, tags] = await Promise.all([
    prisma.user.count(),
    prisma.item.count(),
    prisma.collection.count(),
    prisma.tag.count(),
  ])

  console.log('\nTable counts:')
  console.log(`  users:       ${users}`)
  console.log(`  items:       ${items}`)
  console.log(`  collections: ${collections}`)
  console.log(`  tags:        ${tags}`)

  // Demo user
  console.log('\nDemo user:')
  const demoUser = await prisma.user.findUnique({
    where: { email: 'demo@devstash.io' },
    select: { id: true, email: true, name: true, isPro: true, emailVerified: true },
  })

  if (!demoUser) {
    console.log('  ✗ demo@devstash.io not found — run npm run db:seed')
  } else {
    console.log(`  ✓ ${demoUser.email} (${demoUser.name})`)
    console.log(`    isPro: ${demoUser.isPro}  emailVerified: ${demoUser.emailVerified?.toISOString() ?? 'null'}`)

    // Collections with item counts
    const userCollections = await prisma.collection.findMany({
      where: { userId: demoUser.id },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true } } },
    })

    console.log(`\nCollections (${userCollections.length}):`)
    userCollections.forEach((c) => {
      console.log(`  ✓ ${c.name} — ${c._count.items} item(s)`)
    })

    // Items grouped by type
    const userItems = await prisma.item.findMany({
      where: { userId: demoUser.id },
      include: { itemType: true },
      orderBy: [{ itemType: { name: 'asc' } }, { title: 'asc' }],
    })

    console.log(`\nItems (${userItems.length}):`)
    let lastType = ''
    userItems.forEach((item) => {
      if (item.itemType.name !== lastType) {
        lastType = item.itemType.name
        console.log(`  [${item.itemType.name}]`)
      }
      const preview =
        item.contentType === 'URL'
          ? item.url ?? ''
          : (item.content ?? '').split('\n')[0].slice(0, 60)
      console.log(`    • ${item.title}${preview ? `  →  ${preview}` : ''}`)
    })
  }

  console.log('\n✓ All checks passed')
}

main()
  .catch((err) => {
    console.error('✗ Database test failed:', err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
