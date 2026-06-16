import { authedRoute } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { createItemInput, fetchItemsQuerySchema } from '@/lib/api/schemas/items'
import {
  getRecentItemsPage,
  getItemsByTypePage,
  getItemsByCollectionPage,
  getFavoriteItemsPage,
  createItem,
} from '@/lib/db/items'
import { canCreateItem, FREE_TIER_ITEM_LIMIT } from '@/lib/db/usage'
import { invalidateCollectionsCache, invalidateItemsCache } from '@/lib/infra/cache'
import { deleteFromS3 } from '@/lib/storage/s3'
import { consumePendingUpload } from '@/lib/storage/upload-tokens'
import { ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES, PRO_ITEM_TYPE_NAMES_LABEL } from '@/lib/utils/constants'
import { logger } from '@/lib/infra/pino'
import type { ItemsPage } from '@/types/item'

const log = logger.child({ tag: 'api-items' })

export const GET = authedRoute({}, async ({ userId, request }) => {
  const parsed = parseOr422(fetchItemsQuerySchema, Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.ok) return parsed.res

  const query = parsed.data
  let page: ItemsPage
  switch (query.type) {
    case 'recent':
      page = await getRecentItemsPage(userId, query.cursor)
      break
    case 'type':
      page = await getItemsByTypePage(userId, query.typeName, query.cursor)
      break
    case 'collection':
      page = await getItemsByCollectionPage(userId, query.collectionId, query.cursor)
      break
    case 'favorites':
      page = await getFavoriteItemsPage(userId, query.cursor)
      break
  }
  return json(page)
})

export const POST = authedRoute({ rateLimit: 'itemMutation' }, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(createItemInput, await request.json())
  if (!parsed.ok) return parsed.res
  const input = parsed.data

  if (PRO_ITEM_TYPE_NAMES.has(input.itemTypeName) && !isPro) {
    return problem(403, `Upgrade to Pro to upload ${PRO_ITEM_TYPE_NAMES_LABEL}.`)
  }

  if (!(await canCreateItem(userId, isPro))) {
    return problem(
      403,
      `You have reached your free tier limit of ${FREE_TIER_ITEM_LIMIT} items. Please upgrade to Pro.`,
    )
  }

  const isFileType = ITEM_TYPES_WITH_FILE.has(input.itemTypeName)

  let fileName: string | null = null
  let fileSize: number | null = null
  let thumbKey: string | null = null

  if (isFileType && input.fileUrl) {
    const result = await consumePendingUpload(input.fileUrl, userId)
    if (!result.ok) {
      if (result.reason === 'unavailable') {
        return problem(500, 'Upload service temporarily unavailable.')
      }
      return problem(403, 'Invalid file reference.')
    }
    fileName = result.data.fileName
    fileSize = result.data.fileSize
    thumbKey = result.data.thumbKey
  }

  const created = await createItem(userId, {
    title: input.title,
    description: input.description,
    content: isFileType ? null : input.content,
    url: isFileType ? null : input.url,
    language: isFileType ? null : input.language,
    tags: input.tags,
    collectionIds: input.collectionIds,
    itemTypeName: input.itemTypeName,
    fileUrl: isFileType ? input.fileUrl : null,
    fileName,
    fileSize,
    imageWidth: isFileType ? (input.imageWidth ?? null) : null,
    imageHeight: isFileType ? (input.imageHeight ?? null) : null,
  }).catch((err) => {
    log.error({ userId, err }, 'createItem failed')
    return null
  })

  if (!created) {
    if (isFileType && input.fileUrl) {
      await deleteFromS3(input.fileUrl)
      if (thumbKey) await deleteFromS3(thumbKey)
    }
    return problem(500, 'Failed to create item.')
  }

  invalidateItemsCache(userId)
  if (input.collectionIds.length > 0) invalidateCollectionsCache(userId)
  log.info({ userId, itemTypeName: input.itemTypeName, title: input.title }, 'Item created')
  return json(created, 201)
})
