import 'server-only'
import { z } from 'zod'
import { authenticatedRoute } from '@/lib/api'
import { ApiResponse } from '@/lib/api'
import { parseOrFail, createItemSchema } from '@/lib/utils/validators'
import {
  getRecentItemsPage,
  getItemsByTypePage,
  getItemsByCollectionPage,
  getFavoriteItemsPage,
  createItem as dbCreateItem,
} from '@/lib/db/items'
import { canCreateItem, FREE_TIER_ITEM_LIMIT } from '@/lib/db/usage'
import { invalidateCollectionsCache, invalidateItemsCache } from '@/lib/infra/cache'
import { deleteFromS3 } from '@/lib/storage/s3'
import { consumePendingUpload } from '@/lib/storage/upload-tokens'
import { ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES, PRO_ITEM_TYPE_NAMES_LABEL } from '@/lib/utils/constants'
import { createLogger } from '@/lib/infra/logger'
import type { ItemsPage } from '@/types/item'

const log = createLogger('api-items')

const fetchItemsQuerySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('recent'), cursor: z.string().optional() }),
  z.object({ type: z.literal('type'), typeName: z.string().trim().min(1, 'Item type is required.'), cursor: z.string().optional() }),
  z.object({ type: z.literal('collection'), collectionId: z.string().trim().min(1, 'Collection is required.'), cursor: z.string().optional() }),
  z.object({ type: z.literal('favorites'), cursor: z.string().optional() }),
])

export const GET = authenticatedRoute(async (request, _context, { userId }) => {
  const { searchParams } = new URL(request.url)
  const raw = Object.fromEntries(searchParams.entries())

  const parsed = parseOrFail(fetchItemsQuerySchema, raw)
  if (!parsed.success) return parsed.response

  let page: ItemsPage
  switch (parsed.data.type) {
    case 'recent':
      page = await getRecentItemsPage(userId, parsed.data.cursor)
      break
    case 'type':
      page = await getItemsByTypePage(userId, parsed.data.typeName, parsed.data.cursor)
      break
    case 'collection':
      page = await getItemsByCollectionPage(userId, parsed.data.collectionId, parsed.data.cursor)
      break
    case 'favorites':
      page = await getFavoriteItemsPage(userId, parsed.data.cursor)
      break
  }

  return ApiResponse.OK(page)
})

export const POST = authenticatedRoute(async (request, _context, { userId, isPro }) => {
  const body: unknown = await request.json()
  const parsed = parseOrFail(createItemSchema, body)
  if (!parsed.success) return parsed.response
  const data = parsed.data

  if (PRO_ITEM_TYPE_NAMES.has(data.itemTypeName) && !isPro) {
    return ApiResponse.FORBIDDEN(`Upgrade to Pro to upload ${PRO_ITEM_TYPE_NAMES_LABEL}.`)
  }

  const canCreate = await canCreateItem(userId, isPro)
  if (!canCreate) {
    return ApiResponse.FORBIDDEN(`You have reached your free tier limit of ${FREE_TIER_ITEM_LIMIT} items. Please upgrade to Pro.`)
  }

  const isFileType = ITEM_TYPES_WITH_FILE.has(data.itemTypeName)

  let fileName: string | null = null
  let fileSize: number | null = null
  let thumbKey: string | null = null

  if (isFileType && data.fileUrl) {
    const result = await consumePendingUpload(data.fileUrl, userId)
    if (!result.ok) {
      if (result.reason === 'unavailable') return ApiResponse.INTERNAL_ERROR('Upload service temporarily unavailable.')
      return ApiResponse.FORBIDDEN('Invalid file reference.')
    }
    fileName = result.data.fileName
    fileSize = result.data.fileSize
    thumbKey = result.data.thumbKey
  }

  const created = await dbCreateItem(userId, {
    title: data.title,
    description: data.description,
    content: isFileType ? null : data.content,
    url: isFileType ? null : data.url,
    language: isFileType ? null : data.language,
    tags: data.tags,
    collectionIds: data.collectionIds,
    itemTypeName: data.itemTypeName,
    fileUrl: isFileType ? data.fileUrl : null,
    fileName,
    fileSize,
    imageWidth: isFileType ? (data.imageWidth ?? null) : null,
    imageHeight: isFileType ? (data.imageHeight ?? null) : null,
  }).catch((err) => { log.error('createItem failed', { userId, err }); return null })

  if (!created) {
    if (isFileType && data.fileUrl) {
      await deleteFromS3(data.fileUrl)
      if (thumbKey) await deleteFromS3(thumbKey)
    }
    return ApiResponse.INTERNAL_ERROR('Failed to create item.')
  }

  invalidateItemsCache(userId)
  if (data.collectionIds.length > 0) invalidateCollectionsCache(userId)
  log.info('Item created', { userId, itemTypeName: data.itemTypeName, title: data.title })
  return ApiResponse.CREATED(created)
})
