'use client'

import { toast } from 'sonner'
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { usePatchItem, useSyncItemCollections } from '@/hooks/use-infinite-items'
import { useCacheItemDetail } from '@/hooks/use-item-detail'
import { useInvalidate } from '@/hooks/use-cache-invalidation'
import { queryKeys } from '@/lib/api/query-keys'
import { usePinnedItemsStore } from '@/stores/pinned-items'
import { remapLanguageForType } from '@/lib/utils/constants'
import type { UpdateItemInput } from '@/lib/utils/validators'
import type { ItemsPage, LightItem, FullItem } from '@/types/item'

type UpdateItemPayload = UpdateItemInput

interface UpdateItemOptions {
  onSave: (updated: FullItem) => void
  // Override the success toast copy (e.g. the explain flow saves the explanation as the description).
  successMessage?: string
}

interface UpdateItemVariables {
  currentItem: FullItem
  payload: UpdateItemPayload
  options: UpdateItemOptions
}

export function useUpdateItem() {
  const queryClient = useQueryClient()
  const patchItem = usePatchItem()
  const syncItemCollections = useSyncItemCollections()
  const patchPinnedItem = usePinnedItemsStore((s) => s.patchPinnedItem)
  const cacheItemDetail = useCacheItemDetail()
  const invalidate = useInvalidate()

  // Optimistic edit/save as a canonical useMutation: mutationFn throws on error (so onError fires),
  // onMutate cancels + snapshots + writes the optimistic patch, onSuccess reconciles with the server
  // response, onError rolls back from the snapshot. The public wrapper below keeps the original contract
  // — `(currentItem, payload, options) => Promise<void>` that resolves on completion and never throws.
  const mutation = useMutation({
    mutationFn: async ({ currentItem, payload }: UpdateItemVariables) => {
      const { data, error } = await api.PATCH('/items/{id}', {
        params: { path: { id: currentItem.id } },
        body: payload,
      })
      if (error) throw new Error(error.message || 'Failed to save item')
      return data
    },
    onMutate: async ({ currentItem, payload }: UpdateItemVariables) => {
      // Cancel any in-flight items refetch first so it can't land mid-mutation and clobber the optimistic
      // patch written below (TanStack optimistic-update guidance — cancel → snapshot → write).
      await queryClient.cancelQueries({ queryKey: queryKeys.items.root })
      // Snapshot all matching cache entries for rollback on failure.
      const snapshots = queryClient.getQueriesData<InfiniteData<ItemsPage>>({ queryKey: queryKeys.items.root })

      const optimisticPatch: Partial<LightItem> = {
        title: payload.title,
        url: payload.url ?? null,
        tags: payload.tags ?? [],
        descriptionPreview: payload.description ? payload.description.slice(0, 150) : null,
        contentPreview: payload.content ? payload.content.slice(0, 150) : null,
        // Live type change (v3): reflect the new (text) type in the list cache so the item re-buckets;
        // the server remaps language for the type, which the success branch below mirrors.
        ...(payload.itemTypeName ? { itemType: { ...currentItem.itemType, name: payload.itemTypeName } } : {}),
      }

      const oldCollectionIds = currentItem.collections.map((c) => c.id)
      const newCollectionIds = payload.collectionIds ?? []
      const removedCollectionIds = oldCollectionIds.filter((id) => !newCollectionIds.includes(id))
      const addedCollectionIds = newCollectionIds.filter((id) => !oldCollectionIds.includes(id))

      patchItem(currentItem.id, optimisticPatch)
      syncItemCollections(currentItem.id, { ...currentItem, ...optimisticPatch }, removedCollectionIds, addedCollectionIds)
      return { snapshots, optimisticPatch }
    },
    onSuccess: (data, { currentItem, payload, options }, context) => {
      const serverPatch: Partial<LightItem> = {
        url: data.url,
        tags: data.tags,
        isFavorite: data.isFavorite,
        isPinned: data.isPinned,
        descriptionPreview: data.description ? data.description.slice(0, 150) : null,
      }
      patchItem(currentItem.id, { ...context.optimisticPatch, ...serverPatch })
      // On a type change the server best-effort remaps the language for the new type (e.g. clears it on
      // →note); mirror that here so the drawer/cache match what was persisted.
      const nextItemType = payload.itemTypeName
        ? { ...currentItem.itemType, name: payload.itemTypeName }
        : currentItem.itemType
      const nextLanguage = payload.itemTypeName
        ? remapLanguageForType(payload.language, payload.itemTypeName)
        : payload.language?.trim() || null
      // Only seed content from the payload when it was actually sent — a contentless PATCH must not
      // clobber the cached content with null. (The drawer edit form always sends a full body today; this
      // guards future partial-PATCH callers.)
      const nextContent = payload.content !== undefined ? payload.content : (currentItem.content ?? null)
      const fullUpdated: FullItem = {
        ...currentItem,
        ...data,
        title: payload.title,
        content: nextContent,
        itemType: nextItemType,
        language: nextLanguage,
        descriptionPreview: data.description ? data.description.slice(0, 150) : null,
        contentPreview: nextContent ? nextContent.slice(0, 150) : null,
      }
      // Refresh all three item-detail caches (full + /details + /content) so a later drawer-open — by
      // deep-link or from a list — reflects this save instead of serving a pre-edit copy under staleTime.
      cacheItemDetail(fullUpdated)
      // A type change re-buckets the item. `mapItemInPages` already patched its `itemType` in place
      // across every `['items']` query (so a mounted list's icon/color updates live), but the type-paged
      // lists filter by type at fetch time, so they must refetch to drop it from the old type and add it
      // to the new. `refetchType: 'all'` is deliberate: the drawer is usually open over a DIFFERENT page
      // than the dashboard, so the dashboard recent query is INACTIVE at save time — the default
      // 'active' refetch would skip it, leaving it stale (the 5-min staleTime keeps it from refetching
      // on the next visit), which is the "doesn't appear until full reload" symptom. 'all' refetches
      // inactive queries too, so the dashboard is correct the moment you navigate back.
      if (payload.itemTypeName && payload.itemTypeName !== currentItem.itemType.name) {
        invalidate('items', { refetchType: 'all' })
      }
      // The dashboard Pinned widget renders from the pinned-items STORE (server snapshot + live
      // overrides), not the `['items']` query — so the invalidation above doesn't reach it. If the
      // edited item is pinned, refresh its stored snapshot so the new type (icon/color/title) shows
      // without a reload. (fullUpdated is a FullItem, assignable to the store's LightItem.)
      if (fullUpdated.isPinned) patchPinnedItem(fullUpdated)
      // The Brain Dump source picker filters by the `brain-dump` tag (and item type) but caches its
      // own list, which this PATCH never touches. Adding/removing the tag — or re-typing a note out of
      // the eligible set — must drop the stale picker entry without a page reload. Fire-and-forget; a
      // true no-op when no picker is mounted (default `refetchType: 'active'`).
      invalidate('brainDumpSources')
      options.onSave(fullUpdated)
      toast.success(options.successMessage ?? 'Item saved')
    },
    onError: (error: Error, _variables, context) => {
      // Rollback optimistic patch. The snapshot covers every `['items']` query — including the
      // collection-paged lists `syncItemCollections` mutated above — so restoring it fully reverts the
      // collection re-sync too; no second sync call (which would double-revert and re-insert duplicates).
      context?.snapshots.forEach(([queryKey, snapshot]) => queryClient.setQueryData(queryKey, snapshot))
      toast.error(error.message || 'Failed to save item')
    },
  })

  return async (currentItem: FullItem, payload: UpdateItemPayload, options: UpdateItemOptions): Promise<void> => {
    // Preserve the original never-throws contract: onError already toasted + rolled back, so swallow the
    // rejection mutateAsync surfaces and resolve void once the mutation settles.
    try {
      await mutation.mutateAsync({ currentItem, payload, options })
    } catch {
      /* handled in onError */
    }
  }
}

// The four text types a committed item can be re-typed among (mirrors the server allow-list). Used to
// build the drawer's type-switch options and type the staged `itemTypeName` sent on Save.
export type TextItemTypeName = 'snippet' | 'prompt' | 'command' | 'note'
