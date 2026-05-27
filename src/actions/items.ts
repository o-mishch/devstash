'use server'

import { z } from 'zod'
import { auth } from '@/auth'
import { ApiResponse } from '@/lib/api'
import { updateItem as dbUpdateItem, deleteItem as dbDeleteItem, getItemById as dbGetItemById, createItem as dbCreateItem } from '@/lib/db/items'
import { invalidateItemsCache } from '@/lib/cache'
import { ITEM_TYPES_WITH_URL } from '@/lib/utils/constants'
import type { ApiBody } from '@/types/api'
import type { ItemDetail } from '@/types/item'

const baseItemSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().optional().nullable().transform((v) => v || null),
  content: z.string().optional().nullable().transform((v) => v || null),
  url: z.union([z.string().trim().pipe(z.url('Must be a valid URL')), z.literal('')]).optional().nullable().transform((v) => v || null),
  language: z.string().trim().optional().nullable().transform((v) => v || null),
  tags: z.array(z.string().trim().min(1)).default([]),
})

const updateItemSchema = baseItemSchema

type UpdateItemInput = z.infer<typeof updateItemSchema>

const createItemSchema = baseItemSchema.extend({
  itemTypeName: z.string().trim().min(1, 'Type is required'),
}).refine((data) => {
  if (ITEM_TYPES_WITH_URL.has(data.itemTypeName) && !data.url) return false
  return true
}, {
  message: 'URL is required for links',
  path: ['url'],
})

type CreateItemInput = z.infer<typeof createItemSchema>

export async function createItemAction(raw: CreateItemInput): Promise<ApiBody<ItemDetail | null>> {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  const parsed = createItemSchema.safeParse(raw)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Validation failed'
    return ApiResponse.VALIDATION_ERROR(message)
  }

  try {
    const created = await dbCreateItem(session.user.id, parsed.data)
    if (!created) return ApiResponse.INTERNAL_ERROR('Failed to create item.')

    invalidateItemsCache(session.user.id, created.itemType.name)

    return ApiResponse.CREATED(created)
  } catch (error) {
    console.error('[createItemAction] Error:', error)
    return ApiResponse.INTERNAL_ERROR()
  }
}

export async function updateItemAction(
  itemId: string,
  raw: UpdateItemInput
): Promise<ApiBody<ItemDetail | null>> {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  const parsed = updateItemSchema.safeParse(raw)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Validation failed'
    return ApiResponse.VALIDATION_ERROR(message)
  }

  try {
    const updated = await dbUpdateItem(session.user.id, itemId, parsed.data)
    if (!updated) return ApiResponse.NOT_FOUND('Item not found.')

    invalidateItemsCache(session.user.id, updated.itemType.name)

    return ApiResponse.OK(updated)
  } catch (error) {
    console.error('[updateItemAction] Error:', error)
    return ApiResponse.INTERNAL_ERROR()
  }
}

export async function deleteItemAction(itemId: string): Promise<ApiBody<void>> {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  try {
    const existing = await dbGetItemById(session.user.id, itemId)
    if (!existing) return ApiResponse.NOT_FOUND('Item not found.')

    const deleted = await dbDeleteItem(session.user.id, itemId)
    if (!deleted) return ApiResponse.INTERNAL_ERROR('Failed to delete item.')

    invalidateItemsCache(session.user.id, existing.itemType.name)

    return ApiResponse.OK()
  } catch (error) {
    console.error('[deleteItemAction] Error:', error)
    return ApiResponse.INTERNAL_ERROR()
  }
}
