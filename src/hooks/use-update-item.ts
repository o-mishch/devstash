'use client'

import { toast } from 'sonner'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { safe } from '@orpc/client'
import { orpcClient } from '@/lib/api/client'
import { mapItemInPages } from '@/hooks/use-infinite-items'
import { useItemsStore } from '@/stores/items'
import type { UpdateItemInput } from '@/lib/utils/validators'
import type { ItemsPage, LightItem, FullItem } from '@/types/item'

type UpdateItemPayload = UpdateItemInput

interface UpdateItemOptions {
  onSave: (updated: FullItem) => void
}

export function useUpdateItem() {
  const queryClient = useQueryClient()
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

    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      { queryKey: ['items'] },
      (old) => mapItemInPages(old, currentItem.id, optimisticPatch)
    )
    updateItem({ ...currentItem, ...optimisticPatch })

    const { error, data } = await safe(orpcClient.items.update({ id: currentItem.id, ...payload }))

    if (!error) {
      const serverPatch: Partial<LightItem> = {
        url: data.url,
        tags: data.tags,
        isFavorite: data.isFavorite,
        isPinned: data.isPinned,
        descriptionPreview: data.description ? data.description.slice(0, 150) : null,
      }
      queryClient.setQueriesData<InfiniteData<ItemsPage>>(
        { queryKey: ['items'] },
        (old) => mapItemInPages(old, currentItem.id, { ...optimisticPatch, ...serverPatch })
      )
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
      void queryClient.invalidateQueries({ queryKey: ['items'], refetchType: 'none' })
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
