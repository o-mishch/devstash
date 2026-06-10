import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import {
  canGenerateImageThumbnail,
  generateImageThumbnail,
  getImageThumbnailKey,
} from '../src/lib/storage/image-thumbnails'
import { downloadFromFilebase, uploadToFilebase } from '../src/lib/storage/filebase'

const DRY_RUN = process.argv.includes('--dry-run')

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  console.log(DRY_RUN ? 'Running in dry-run mode (no writes)\n' : 'Running backfill\n')

  const imageType = await prisma.itemType.findFirst({
    where: { name: 'image', isSystem: true, userId: null },
    select: { id: true },
  })

  if (!imageType) {
    console.error('✗ System image item type not found — aborting')
    process.exit(1)
  }

  const items = await prisma.item.findMany({
    where: {
      itemTypeId: imageType.id,
      fileUrl: { not: null },
    },
    select: { id: true, fileUrl: true, fileName: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Found ${items.length.toLocaleString()} image items\n`)

  let skippedSvg = 0
  let skippedMissingFile = 0
  let skippedHasThumb = 0
  let generated = 0
  let failed = 0

  for (const item of items) {
    const fileUrl = item.fileUrl!
    const thumbKey = getImageThumbnailKey(fileUrl)

    if (!canGenerateImageThumbnail(fileUrl)) {
      skippedSvg++
      console.log(`  skip svg/unsupported: ${item.id} (${fileUrl})`)
      continue
    }

    const existingThumb = await downloadFromFilebase(thumbKey)
    if (existingThumb) {
      existingThumb.destroy()
      skippedHasThumb++
      continue
    }

    const source = await downloadFromFilebase(fileUrl)
    if (!source) {
      skippedMissingFile++
      console.log(`  skip missing file: ${item.id} (${fileUrl})`)
      continue
    }

    const chunks: Buffer[] = []
    for await (const chunk of source) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)

    if (DRY_RUN) {
      generated++
      console.log(`  would generate thumb: ${item.id} → ${thumbKey}`)
      continue
    }

    try {
      const thumbnail = await generateImageThumbnail(buffer)
      await uploadToFilebase(thumbKey, thumbnail, 'image/webp')
      generated++
      console.log(`  generated: ${item.id} → ${thumbKey}`)
    } catch (err) {
      failed++
      console.error(`  failed: ${item.id}`, err)
    }
  }

  console.log('\nSummary')
  console.log(`  skipped (svg/unsupported): ${skippedSvg}`)
  console.log(`  skipped (already has thumb): ${skippedHasThumb}`)
  console.log(`  skipped (missing source file): ${skippedMissingFile}`)
  console.log(`  ${DRY_RUN ? 'would generate' : 'generated'}: ${generated}`)
  if (failed > 0) console.log(`  failed: ${failed}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
