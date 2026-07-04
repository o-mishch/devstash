'use client'

import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useDownloadSrcActions } from '@/hooks/billing/use-pro-download-src'
import { usePrependItem, useReplaceItem, useRemoveItem, useInvalidateItems } from '@/hooks/items/use-infinite-items'
import { useInvalidate } from '@/hooks/items/use-cache-invalidation'
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

interface CreateItemVariables {
  payload: CreateItemPayload
  options?: CreateItemOptions
}

export function useCreateItem() {
  const prependItem = usePrependItem()
  const replaceItem = useReplaceItem()
  const tqRemoveItem = useRemoveItem()
  const invalidateItems = useInvalidateItems()
  const invalidate = useInvalidate()
  const { seed: seedPreviewCache, clear: clearDownloadSrcCache } = useDownloadSrcActions()

  // Fire-and-forget optimistic create as a useMutation: onMutate prepends the temp card (the caller
  // resolves and the dialog closes immediately), onSuccess swaps in the real item, onError removes the
  // temp card and rolls back. mutationFn throws on error so onError fires. The temp id flows via context.
  const mutation = useMutation({
    mutationFn: async ({ payload }: CreateItemVariables) => {
      const { data, error } = await api.POST('/items', { body: payload })
      if (error) throw new Error(error.message || 'Failed to create item')
      return data
    },
    onMutate: async ({ payload, options }: CreateItemVariables) => {
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
      if (options?.localPreviewUrl) seedPreviewCache(tempId, options.localPreviewUrl)
      return { tempId }
    },
    onSuccess: (data, { payload, options }, { tempId }) => {
      if (options?.localPreviewUrl) {
        // Transfer the blob URL to the real ID before swapping the card — zero-flicker handoff.
        clearDownloadSrcCache(tempId)
        seedPreviewCache(data.id, options.localPreviewUrl)
      }
      replaceItem(tempId, data)
      invalidateItems('none')
      if (payload.collectionIds && payload.collectionIds.length > 0) invalidate('collections')
      // A new item can push a free-tier user over the item limit, flipping canCreateItem in /profile/me
      // (which gates the create dialog).
      invalidate('userProfile')
    },
    onError: (error: Error, { options }, context) => {
      if (context?.tempId) tqRemoveItem(context.tempId)
      options?.onRollback?.()
      toast.error(error.message || 'Failed to create item')
    },
  })

  // Preserve the original contract: resolve once the optimistic prepend is on screen while the POST runs
  // in the background. `mutate` (not `mutateAsync`) is fire-and-forget — onSuccess/onError settle later.
  return (payload: CreateItemPayload, options?: CreateItemOptions): void => {
    mutation.mutate({ payload, options })
  }
}
