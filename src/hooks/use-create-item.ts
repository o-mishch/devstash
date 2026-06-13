'use client'

import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { createItemAction } from '@/actions/items'
import { useItemsStore } from '@/stores/items'
import { seedPreviewCache, clearSignedDownloadUrlCache } from '@/hooks/use-pro-download-src'
import { usePrependItem, useReplaceItem, useRemoveItem } from '@/hooks/use-infinite-items'
import type { LightItem } from '@/types/item'

type CreateItemPayload = Parameters<typeof createItemAction>[0]

interface CreateItemOptions {
  onRollback?: () => void
  /** Local ObjectURL of the uploaded image thumbnail — serves the temp card preview from memory, no S3 request. */
  localPreviewUrl?: string
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
      fileName: payload.fileName ?? null,
      fileSize: payload.fileSize ?? null,
      isFavorite: false,
      isPinned: false,
    }

    await prependItem(tempItem, payload.collectionIds)
    updateItem(tempItem)
    if (options?.localPreviewUrl) seedPreviewCache(tempId, options.localPreviewUrl)

    // The caller resolves here — dialog closes while the API call continues in background.
    void createItemAction(payload).then((result) => {
      if (result.status === 'created' || result.status === 'ok') {
        if (result.data) {
          if (options?.localPreviewUrl) {
            // Transfer the blob URL to the real ID before swapping the card — zero-flicker handoff.
            clearSignedDownloadUrlCache(tempId)
            seedPreviewCache(result.data.id, options.localPreviewUrl)
          }
          replaceItem(tempId, result.data)
          removeItem(tempId)
          updateItem(result.data)
        }
        void queryClient.invalidateQueries({ queryKey: ['items'], refetchType: 'none' })
      } else {
        tqRemoveItem(tempId)
        removeItem(tempId)
        options?.onRollback?.()
        toast.error(result.message ?? 'Failed to create item')
      }
    })
  }
}
