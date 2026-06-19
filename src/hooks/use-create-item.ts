'use client'

import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useItemsStore } from '@/stores/items'
import { seedPreviewCache, clearSignedDownloadUrlCache } from '@/lib/api/signed-download-cache'
import { usePrependItem, useReplaceItem, useRemoveItem, useInvalidateItems } from '@/hooks/use-infinite-items'
import type { CreateItemInput } from '@/lib/utils/validators'
import type { LightItem } from '@/types/item'

type CreateItemPayload = CreateItemInput

interface CreateItemOptions {
  onRollback?: () => void
  /** Local ObjectURL of the uploaded image thumbnail — serves the temp card preview from memory, no S3 request. */
  localPreviewUrl?: string
  /** Optimistic display values for file/image cards — not sent to the server (server reads from Redis). */
  optimisticFileName?: string | null
  optimisticFileSize?: number | null
}

export function useCreateItem() {
  const prependItem = usePrependItem()
  const replaceItem = useReplaceItem()
  const tqRemoveItem = useRemoveItem()
  const invalidateItems = useInvalidateItems()
  const { updateItem, removeItem } = useItemsStore()

  return async (payload: CreateItemPayload, options?: CreateItemOptions): Promise<void> => {
    const tempId = crypto.randomUUID()
    const tempItem: LightItem = {
      id: tempId,
      title: payload.title,
      createdAt: new Date().toISOString(),
      itemType: { name: payload.itemTypeName },
      descriptionPreview: payload.description ?? null,
      contentPreview: payload.content ?? null,
      url: payload.url ?? null,
      tags: payload.tags ?? [],
      fileName: options?.optimisticFileName ?? null,
      fileSize: options?.optimisticFileSize ?? null,
      isFavorite: false,
      isPinned: false,
    }

    await prependItem(tempItem, payload.collectionIds)
    updateItem(tempItem)
    if (options?.localPreviewUrl) seedPreviewCache(tempId, options.localPreviewUrl)

    // The caller resolves here — dialog closes while the API call continues in background.
    void api.POST('/items', { body: payload }).then(({ data, error }) => {
      if (!error) {
        if (options?.localPreviewUrl) {
          // Transfer the blob URL to the real ID before swapping the card — zero-flicker handoff.
          clearSignedDownloadUrlCache(tempId)
          seedPreviewCache(data.id, options.localPreviewUrl)
        }
        replaceItem(tempId, data)
        removeItem(tempId)
        updateItem(data)
        invalidateItems('none')
      } else {
        tqRemoveItem(tempId)
        removeItem(tempId)
        options?.onRollback?.()
        toast.error(error.message || 'Failed to create item')
      }
    })
  }
}
