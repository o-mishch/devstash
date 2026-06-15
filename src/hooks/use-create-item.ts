'use client'

import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { safe } from '@orpc/client'
import { orpcClient } from '@/lib/api/client'
import { useItemsStore } from '@/stores/items'
import { seedPreviewCache, clearSignedDownloadUrlCache } from '@/hooks/use-pro-download-src'
import { usePrependItem, useReplaceItem, useRemoveItem } from '@/hooks/use-infinite-items'
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
  const queryClient = useQueryClient()
  const prependItem = usePrependItem()
  const replaceItem = useReplaceItem()
  const tqRemoveItem = useRemoveItem()
  const { updateItem, removeItem } = useItemsStore()

  return async (payload: CreateItemPayload, options?: CreateItemOptions): Promise<void> => {
    const tempId = crypto.randomUUID()
    const tempItem: LightItem = {
      id: tempId,
      title: payload.title,
      createdAt: new Date(),
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
    void safe(orpcClient.items.create(payload)).then(({ error, data }) => {
      if (!error) {
        if (options?.localPreviewUrl) {
          // Transfer the blob URL to the real ID before swapping the card — zero-flicker handoff.
          clearSignedDownloadUrlCache(tempId)
          seedPreviewCache(data.id, options.localPreviewUrl)
        }
        replaceItem(tempId, data)
        removeItem(tempId)
        updateItem(data)
        void queryClient.invalidateQueries({ queryKey: ['items'], refetchType: 'none' })
      } else {
        tqRemoveItem(tempId)
        removeItem(tempId)
        options?.onRollback?.()
        toast.error(error.message || 'Failed to create item')
      }
    })
  }
}
