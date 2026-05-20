import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  console.log('Testing database connection...\n')

  // Connection check
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

  console.log('\n✓ All checks passed')
}

main()
  .catch((err) => {
    console.error('✗ Database test failed:', err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
