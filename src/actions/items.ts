'use server'

import { z } from 'zod'
import { ApiResponse } from '@/lib/api'
import { withAuth } from '@/lib/session'
import { parseOrFail } from '@/lib/utils/validators'
import {
  updateItem as dbUpdateItem,
  deleteItem as dbDeleteItem,
  getItemById as dbGetItemById,
  createItem as dbCreateItem,
  getRecentItemsPage,
  getItemsByTypePage,
  getItemsByCollectionPage,
  getFavoriteItemsPage,
} from '@/lib/db/items'
import { invalidateItemsCache } from '@/lib/cache'
import { createLogger } from '@/lib/logger'
import { deleteFromFilebase } from '@/lib/filebase'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE } from '@/lib/utils/constants'
import type { ApiBody } from '@/types/api'
import type { Item, FetchItemsQuery, ItemsPage } from '@/types/item'

const log = createLogger('items')

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

export async function createItemAction(raw: CreateItemInput): Promise<ApiBody<Item | null>> {
  return withAuth(async (userId) => {
    const result = parseOrFail(createItemSchema, raw)
    if (!result.success) return result.response

    const { data } = result

    if (data.fileUrl && !data.fileUrl.startsWith(`${userId}/`)) {
      return ApiResponse.FORBIDDEN('Invalid file reference.')
    }

    const created = await dbCreateItem(userId, data)
    if (!created) return ApiResponse.INTERNAL_ERROR('Failed to create item.')

    invalidateItemsCache(userId)
    log.info(`created "${data.title}" [${data.itemTypeName}] user:${userId}`)

    return ApiResponse.CREATED(created)
  }, 'createItemAction')
}

export async function updateItemAction(
  itemId: string,
  raw: UpdateItemInput
): Promise<ApiBody<Item | null>> {
  return withAuth(async (userId) => {
    const result = parseOrFail(itemMutationSchema, raw)
    if (!result.success) return result.response

    const updated = await dbUpdateItem(userId, itemId, result.data)
    if (!updated) return ApiResponse.NOT_FOUND('Item not found.')

    invalidateItemsCache(userId)
    log.info(`updated item:${itemId} user:${userId}`)

    return ApiResponse.OK(updated)
  }, 'updateItemAction')
}

export async function deleteItemAction(itemId: string): Promise<ApiBody<void>> {
  return withAuth(async (userId) => {
    const existing = await dbGetItemById(userId, itemId)
    if (!existing) return ApiResponse.NOT_FOUND('Item not found.')

    const deleted = await dbDeleteItem(userId, itemId)
    if (!deleted) return ApiResponse.INTERNAL_ERROR('Failed to delete item.')

    if (existing.fileUrl) await deleteFromFilebase(existing.fileUrl)

    invalidateItemsCache(userId)
    log.info(`deleted item:${itemId} user:${userId}`)

    return ApiResponse.OK()
  }, 'deleteItemAction')
}

export async function fetchMoreItemsAction(query: FetchItemsQuery, cursor?: string): Promise<ApiBody<ItemsPage | null>> {
  return withAuth(async (userId) => {
    let page: ItemsPage
    switch (query.type) {
      case 'recent':
        page = await getRecentItemsPage(userId, cursor)
        break
      case 'type':
        page = await getItemsByTypePage(userId, query.typeName, cursor)
        break
      case 'collection':
        page = await getItemsByCollectionPage(userId, query.collectionId, cursor)
        break
      case 'favorites':
        page = await getFavoriteItemsPage(userId, cursor)
        break
    }
    return ApiResponse.OK(page)
  }, 'fetchMoreItemsAction')
}
