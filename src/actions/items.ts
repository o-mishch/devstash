'use server'

import { z } from 'zod'
import { ApiResponse } from '@/lib/api'
import { withAuth, withValidatedAuth } from '@/lib/session'
import { createToggleAction } from '@/lib/app/action-utils'
import { canCreateItem, FREE_TIER_ITEM_LIMIT } from '@/lib/db/usage'
import {
  updateItem as dbUpdateItem,
  deleteItem as dbDeleteItem,
  getItemForAuth as dbGetItemForAuth,
  createItem as dbCreateItem,
  getRecentItemsPage,
  getItemsByTypePage,
  getItemsByCollectionPage,
  getFavoriteItemsPage,
  toggleItemFavorite as dbToggleItemFavorite,
  toggleItemPinned as dbToggleItemPinned,
} from '@/lib/db/items'
import { createLogger } from '@/lib/infra/logger'
import { invalidateItemsCache } from '@/lib/infra/cache'
import { deleteStoredImageFiles } from '@/lib/storage/image-thumbnails'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import { parseOrFail, isOwnedFileReference } from '@/lib/utils/validators'
import type { ApiBody } from '@/types/api'
import type { LightItem, ItemSavedDetails, FetchItemsQuery, ItemsPage } from '@/types/item'

const log = createLogger('items')

const fetchItemsQuerySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('recent') }),
  z.object({ type: z.literal('type'), typeName: z.string().trim().min(1, 'Item type is required.') }),
  z.object({ type: z.literal('collection'), collectionId: z.string().trim().min(1, 'Collection is required.') }),
  z.object({ type: z.literal('favorites') }),
]) satisfies z.ZodType<FetchItemsQuery>

const PRO_TYPE_NAMES_LABEL = [...PRO_ITEM_TYPE_NAMES].join(' and ')

const itemMutationSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().optional().nullable().transform((v) => v || null),
  content: z.string().optional().nullable().transform((v) => v || null),
  url: z.union([z.string().trim().pipe(z.url('Must be a valid URL')), z.literal('')]).optional().nullable().transform((v) => v || null),
  language: z.string().trim().optional().nullable().transform((v) => v || null),
  tags: z.array(z.string().trim().min(1)).default([]),
  collectionIds: z.array(z.string()).default([]),
})

type UpdateItemInput = z.infer<typeof itemMutationSchema>

const createItemSchema = itemMutationSchema.extend({
  itemTypeName: z.string().trim().min(1, 'Type is required'),
  fileUrl: z.string().trim().optional().nullable().transform((v) => v || null),
  fileName: z.string().trim().optional().nullable().transform((v) => v || null),
  fileSize: z.number().int().positive().optional().nullable().transform((v) => v ?? null),
  imageWidth: z.number().int().positive().optional().nullable().transform((v) => v ?? null),
  imageHeight: z.number().int().positive().optional().nullable().transform((v) => v ?? null),
}).refine((data) => {
  if (ITEM_TYPES_WITH_URL.has(data.itemTypeName) && !data.url) return false
  return true
}, {
  message: 'URL is required for links',
  path: ['url'],
}).refine((data) => {
  if (ITEM_TYPES_WITH_FILE.has(data.itemTypeName) && !data.fileUrl) return false
  return true
}, {
  message: 'A file must be uploaded for this type',
  path: ['fileUrl'],
})

type CreateItemInput = z.infer<typeof createItemSchema>

export async function createItemAction(raw: CreateItemInput): Promise<ApiBody<LightItem | null>> {
  return withValidatedAuth(createItemSchema, raw, async ({ userId, isPro }, data: CreateItemInput) => {
    if (PRO_ITEM_TYPE_NAMES.has(data.itemTypeName) && !isPro) {
      return ApiResponse.FORBIDDEN(`Upgrade to Pro to upload ${PRO_TYPE_NAMES_LABEL}.`)
    }

    const canCreate = await canCreateItem(userId, isPro)
    if (!canCreate) {
      return ApiResponse.FORBIDDEN(`You have reached your free tier limit of ${FREE_TIER_ITEM_LIMIT} items. Please upgrade to Pro.`)
    }

    if (data.fileUrl && !isOwnedFileReference(data.fileUrl, userId)) {
      return ApiResponse.FORBIDDEN('Invalid file reference.')
    }

    const created = await dbCreateItem(userId, { ...data, imageWidth: data.imageWidth ?? null, imageHeight: data.imageHeight ?? null })
    if (!created) return ApiResponse.INTERNAL_ERROR('Failed to create item.')

    invalidateItemsCache(userId)
    log.info('Item created', { userId, itemTypeName: data.itemTypeName, title: data.title })
    return ApiResponse.CREATED(created)
  }, 'createItemAction')
}

export async function updateItemAction(
  itemId: string,
  raw: UpdateItemInput
): Promise<ApiBody<ItemSavedDetails | null>> {
  return withValidatedAuth(itemMutationSchema, raw, async ({ userId, isPro }, data: UpdateItemInput) => {
    const existing = await dbGetItemForAuth(userId, itemId)
    if (!existing) return ApiResponse.NOT_FOUND('Item not found.')

    if (PRO_ITEM_TYPE_NAMES.has(existing.itemType.name) && !isPro) {
      return ApiResponse.FORBIDDEN(`Upgrade to Pro to edit ${PRO_TYPE_NAMES_LABEL}.`)
    }

    const updated = await dbUpdateItem(userId, itemId, data)
    if (!updated) return ApiResponse.NOT_FOUND('Item not found.')

    invalidateItemsCache(userId)
    log.info('Item updated', { userId, itemId })
    return ApiResponse.OK(updated)
  }, 'updateItemAction')
}

export async function deleteItemAction(itemId: string): Promise<ApiBody<void>> {
  return withAuth(async ({ userId }) => {
    const existing = await dbGetItemForAuth(userId, itemId)
    if (!existing) return ApiResponse.NOT_FOUND('Item not found.')

    if (existing.fileUrl) {
      try {
        await deleteStoredImageFiles(existing.fileUrl)
      } catch (error) {
        log.error('Failed to delete file from storage', { userId, itemId, error })
        return ApiResponse.INTERNAL_ERROR('Failed to delete file from storage.')
      }
    }

    const deleted = await dbDeleteItem(userId, itemId)
    if (!deleted) return ApiResponse.INTERNAL_ERROR('Failed to delete item.')

    invalidateItemsCache(userId)

    log.info('Item deleted', { userId, itemId })
    return ApiResponse.OK()
  }, 'deleteItemAction')
}

export async function fetchMoreItemsAction(query: FetchItemsQuery, cursor?: string): Promise<ApiBody<ItemsPage | null>> {
  return withAuth(async ({ userId }) => {
    const parsed = parseOrFail(fetchItemsQuerySchema, query)
    if (!parsed.success) return parsed.response as ApiBody<ItemsPage | null>

    let page: ItemsPage
    switch (parsed.data.type) {
      case 'recent':
        page = await getRecentItemsPage(userId, cursor)
        break
      case 'type':
        page = await getItemsByTypePage(userId, parsed.data.typeName, cursor)
        break
      case 'collection':
        page = await getItemsByCollectionPage(userId, parsed.data.collectionId, cursor)
        break
      case 'favorites':
        page = await getFavoriteItemsPage(userId, cursor)
        break
    }
    return ApiResponse.OK(page)
  }, 'fetchMoreItemsAction')
}

export const toggleItemFavoriteAction = createToggleAction(dbToggleItemFavorite, invalidateItemsCache, 'item')

export const toggleItemPinnedAction = createToggleAction(dbToggleItemPinned, invalidateItemsCache, 'item')
