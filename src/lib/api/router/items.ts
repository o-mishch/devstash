import 'server-only'
import { ORPCError } from '@orpc/server'
import { authed } from '../orpc'
import { enforceRateLimit } from '../middleware'
import { ErrorMessage } from '../error-messages'
import {
  getRecentItemsPage,
  getItemsByTypePage,
  getItemsByCollectionPage,
  getFavoriteItemsPage,
  createItem,
  updateItem,
  deleteItem,
  getItemForAuth,
  getItemContent,
  getItemDetails,
  toggleItemFavorite,
  toggleItemPinned,
} from '@/lib/db/items'
import { canCreateItem, FREE_TIER_ITEM_LIMIT } from '@/lib/db/usage'
import { invalidateCollectionsCache, invalidateItemsCache } from '@/lib/infra/cache'
import { deleteFromS3 } from '@/lib/storage/s3'
import { deleteStoredFile } from '@/lib/storage/image-thumbnails'
import { consumePendingUpload } from '@/lib/storage/upload-tokens'
import { ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES, PRO_ITEM_TYPE_NAMES_LABEL } from '@/lib/utils/constants'
import { logger } from '@/lib/infra/pino'
import type { ItemsPage } from '@/types/item'

const log = logger.child({ tag: 'api-items' })

export const itemsRouter = {
  list: authed.items.list.handler(async ({ input, context }): Promise<ItemsPage> => {
    const { userId } = context
    switch (input.type) {
      case 'recent':
        return getRecentItemsPage(userId, input.cursor)
      case 'type':
        return getItemsByTypePage(userId, input.typeName, input.cursor)
      case 'collection':
        return getItemsByCollectionPage(userId, input.collectionId, input.cursor)
      case 'favorites':
        return getFavoriteItemsPage(userId, input.cursor)
    }
  }),

  create: authed.items.create.handler(async ({ input, context }) => {
    const { userId, isPro } = context
    await enforceRateLimit('itemMutation', userId, context.resHeaders)

    if (PRO_ITEM_TYPE_NAMES.has(input.itemTypeName) && !isPro) {
      throw new ORPCError('FORBIDDEN', { message: `Upgrade to Pro to upload ${PRO_ITEM_TYPE_NAMES_LABEL}.` })
    }

    if (!(await canCreateItem(userId, isPro))) {
      throw new ORPCError('FORBIDDEN', { message: `You have reached your free tier limit of ${FREE_TIER_ITEM_LIMIT} items. Please upgrade to Pro.` })
    }

    const isFileType = ITEM_TYPES_WITH_FILE.has(input.itemTypeName)

    let fileName: string | null = null
    let fileSize: number | null = null
    let thumbKey: string | null = null

    if (isFileType && input.fileUrl) {
      const result = await consumePendingUpload(input.fileUrl, userId)
      if (!result.ok) {
        if (result.reason === 'unavailable') {
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Upload service temporarily unavailable.' })
        }
        throw new ORPCError('FORBIDDEN', { message: 'Invalid file reference.' })
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
    }).catch((err) => { log.error({ userId, err }, 'createItem failed'); return null })

    if (!created) {
      if (isFileType && input.fileUrl) {
        await deleteFromS3(input.fileUrl)
        if (thumbKey) await deleteFromS3(thumbKey)
      }
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to create item.' })
    }

    invalidateItemsCache(userId)
    if (input.collectionIds.length > 0) invalidateCollectionsCache(userId)
    log.info({ userId, itemTypeName: input.itemTypeName, title: input.title }, 'Item created')
    return created
  }),

  update: authed.items.update.handler(async ({ input, context }) => {
    const { userId, isPro } = context
    await enforceRateLimit('itemMutation', userId, context.resHeaders)
    const { id, ...patch } = input

    const existing = await getItemForAuth(userId, id)
    if (!existing) throw new ORPCError('NOT_FOUND', { message: ErrorMessage.ITEM_NOT_FOUND })

    if (PRO_ITEM_TYPE_NAMES.has(existing.itemType.name) && !isPro) {
      throw new ORPCError('FORBIDDEN', { message: `Upgrade to Pro to edit ${PRO_ITEM_TYPE_NAMES_LABEL}.` })
    }

    const updated = await updateItem(userId, id, patch)
    if (!updated) throw new ORPCError('NOT_FOUND', { message: ErrorMessage.ITEM_NOT_FOUND })

    invalidateItemsCache(userId)
    invalidateCollectionsCache(userId)
    log.info({ userId, itemId: id }, 'Item updated')
    return updated
  }),

  remove: authed.items.remove.handler(async ({ input, context }) => {
    const { userId } = context
    await enforceRateLimit('itemMutation', userId, context.resHeaders)

    const existing = await getItemForAuth(userId, input.id)
    if (!existing) throw new ORPCError('NOT_FOUND', { message: ErrorMessage.ITEM_NOT_FOUND })

    if (existing.fileUrl) {
      try {
        await deleteStoredFile(existing.fileUrl)
      } catch (error) {
        log.error({ userId, itemId: input.id, err: error }, 'Failed to delete file from storage')
        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to delete file from storage.' })
      }
    }

    if (!(await deleteItem(userId, input.id))) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to delete item.' })
    }

    invalidateItemsCache(userId)
    invalidateCollectionsCache(userId)
    log.info({ userId, itemId: input.id }, 'Item deleted')
  }),

  getDetails: authed.items.getDetails.handler(async ({ input, context }) => {
    const details = await getItemDetails(context.userId, input.id)
    if (!details) throw new ORPCError('NOT_FOUND', { message: ErrorMessage.ITEM_NOT_FOUND })
    return details
  }),

  getContent: authed.items.getContent.handler(async ({ input, context }) => {
    const content = await getItemContent(context.userId, input.id)
    if (!content) throw new ORPCError('NOT_FOUND', { message: ErrorMessage.ITEM_NOT_FOUND })
    return content
  }),

  toggleFavorite: authed.items.toggleFavorite.handler(async ({ input, context }) => {
    await enforceRateLimit('itemMutation', context.userId, context.resHeaders)
    if (!(await toggleItemFavorite(context.userId, input.id, input.isFavorite))) {
      throw new ORPCError('NOT_FOUND', { message: ErrorMessage.ITEM_NOT_FOUND })
    }
    invalidateItemsCache(context.userId)
    log.info({ userId: context.userId, id: input.id, isFavorite: input.isFavorite }, 'Item favorite toggled')
  }),

  togglePinned: authed.items.togglePinned.handler(async ({ input, context }) => {
    await enforceRateLimit('itemMutation', context.userId, context.resHeaders)
    if (!(await toggleItemPinned(context.userId, input.id, input.isPinned))) {
      throw new ORPCError('NOT_FOUND', { message: ErrorMessage.ITEM_NOT_FOUND })
    }
    invalidateItemsCache(context.userId)
    log.info({ userId: context.userId, id: input.id, isPinned: input.isPinned }, 'Item pinned toggled')
  }),
}
