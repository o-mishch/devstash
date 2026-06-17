'use client'

import { toast } from 'sonner'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { usePatchItem, useSyncItemCollections } from '@/hooks/use-infinite-items'
import { useItemsStore } from '@/stores/items'
import type { UpdateItemInput } from '@/lib/utils/validators'
import type { ItemsPage, LightItem, FullItem } from '@/types/item'

type UpdateItemPayload = UpdateItemInput

interface UpdateItemOptions {
  onSave: (updated: FullItem) => void
}

export function useUpdateItem() {
  const queryClient = useQueryClient()
  const patchItem = usePatchItem()
  const syncItemCollections = useSyncItemCollections()
  const { updateItem } = useItemsStore()

  return async (currentItem: FullItem, payload: UpdateItemPayload, options: UpdateItemOptions): Promise<void> => {
    // Snapshot all matching cache entries for rollback on failure.
    const snapshots = queryClient.getQueriesData<InfiniteData<ItemsPage>>({ queryKey: ['items'] })

    const optimisticPatch: Partial<LightItem> = {
      title: payload.title,
      url: payload.url ?? null,
      tags: payload.tags ?? [],
      descriptionPreview: payload.description ? payload.description.slice(0, 150) : null,
      contentPreview: payload.content ? payload.content.slice(0, 150) : null,
    }

    const oldCollectionIds = currentItem.collections.map((c) => c.id)
    const newCollectionIds = payload.collectionIds ?? []
    const removedCollectionIds = oldCollectionIds.filter((id) => !newCollectionIds.includes(id))
    const addedCollectionIds = newCollectionIds.filter((id) => !oldCollectionIds.includes(id))

    patchItem(currentItem.id, optimisticPatch)
    syncItemCollections(currentItem.id, { ...currentItem, ...optimisticPatch }, removedCollectionIds, addedCollectionIds)
    updateItem({ ...currentItem, ...optimisticPatch })

    const { data, error } = await api.PATCH('/items/{id}', {
      params: { path: { id: currentItem.id } },
      body: payload,
    })

    if (!error) {
      const serverPatch: Partial<LightItem> = {
        url: data.url,
        tags: data.tags,
        isFavorite: data.isFavorite,
        isPinned: data.isPinned,
        descriptionPreview: data.description ? data.description.slice(0, 150) : null,
      }
      patchItem(currentItem.id, { ...optimisticPatch, ...serverPatch })
      const fullUpdated: FullItem = {
        ...currentItem,
        ...data,
        title: payload.title,
        content: payload.content ?? null,
        language: payload.language?.trim() || null,
        descriptionPreview: data.description ? data.description.slice(0, 150) : null,
        contentPreview: payload.content ? payload.content.slice(0, 150) : null,
      }
      updateItem(fullUpdated)
      options.onSave(fullUpdated)
      toast.success('Item saved')
    } else {
      // Rollback optimistic patch.
      for (const [queryKey, snapshot] of snapshots) {
        queryClient.setQueryData(queryKey, snapshot)
      }
      updateItem(currentItem)
      toast.error(error.message || 'Failed to save item')
    }
  }
}
