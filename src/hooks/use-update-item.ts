'use client'

import { toast } from 'sonner'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { updateItemAction } from '@/actions/items'
import { useItemsStore } from '@/stores/items'
import type { ItemsPage, LightItem, FullItem } from '@/types/item'

type UpdateItemPayload = Parameters<typeof updateItemAction>[1]

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
      (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((i) => (i.id === currentItem.id ? { ...i, ...optimisticPatch } : i)),
          })),
        }
      }
    )
    updateItem({ ...currentItem, ...optimisticPatch })

    const result = await updateItemAction(currentItem.id, payload)

    if (result.status === 'ok' && result.data) {
      const serverPatch: Partial<LightItem> = {
        url: result.data.url,
        tags: result.data.tags,
        isFavorite: result.data.isFavorite,
        isPinned: result.data.isPinned,
        descriptionPreview: result.data.description ? result.data.description.slice(0, 150) : null,
      }
      queryClient.setQueriesData<InfiniteData<ItemsPage>>(
        { queryKey: ['items'] },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((i) => (i.id === currentItem.id ? { ...i, ...optimisticPatch, ...serverPatch } : i)),
            })),
          }
        }
      )
      const fullUpdated: FullItem = {
        ...currentItem,
        ...result.data,
        title: payload.title,
        content: payload.content ?? null,
        language: payload.language?.trim() || null,
        descriptionPreview: result.data.description ? result.data.description.slice(0, 150) : null,
        contentPreview: payload.content ? payload.content.slice(0, 150) : null,
      }
      updateItem(fullUpdated)
      void queryClient.invalidateQueries({ queryKey: ['items'], refetchType: 'none' })
      options.onSave(fullUpdated)
      toast.success('Item saved')
    } else {
      // Rollback optimistic patch.
      for (const [queryKey, data] of snapshots) {
        queryClient.setQueryData(queryKey, data)
      }
      updateItem(currentItem)
      toast.error(result.message ?? 'Failed to save item')
    }
  }
}
