'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { $api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { useInvalidate } from '@/hooks/items/use-cache-invalidation'
import type { CollectionWithTypes } from '@/types/collection'

interface UseCollectionsOptions {
  initialData?: CollectionWithTypes[]
  enabled?: boolean
}

export function useCollections(options?: UseCollectionsOptions) {
  // init `undefined` (not `{}`) so the observed key is `['get','/collections']` — matching
  // queryKeys.collections.list() exactly so invalidation reaches this observer. `initialData` seeds
  // the shared cache on first mount, so sibling consumers read the SSR data without a refetch.
  const query = $api.useQuery(
    'get',
    '/collections',
    undefined,
    {
      initialData: options?.initialData,
      enabled: options?.enabled,
      meta: { errorMessage: 'Failed to load collections' },
    }
  )

  return {
    ...query,
    collections: query.data ?? [],
  }
}

export function useCollection(id: string, initialData?: CollectionWithTypes) {
  const query = $api.useQuery(
    'get',
    '/collections/{id}',
    { params: { path: { id } } },
    {
      initialData,
      // retry: false — a 404 means the collection was deleted (e.g. in another tab); settle immediately
      // and fall back to the SSR `initialData` snapshot rather than retrying a gone resource. Mirrors
      // useItemDetail's denormalized-id reader.
      retry: false,
      meta: { errorMessage: 'Failed to load collection details' },
    }
  )

  return {
    ...query,
    collection: query.data,
  }
}

/**
 * Writes a created/updated collection straight into the `GET /collections` list cache so every reader
 * (sidebar, grids, the Brain Dump collection picker) shows it immediately — no refetch round-trip. Per
 * the TanStack pattern, callers pair this synchronous `setQueryData` with `invalidateCollections()` for
 * background reconciliation (server ordering, itemCount). Upserts by id, so it serves create and edit.
 */
export function useUpsertCollectionCache() {
  const queryClient = useQueryClient()
  return useCallback(
    (collection: CollectionWithTypes) => {
      queryClient.setQueryData<CollectionWithTypes[]>(queryKeys.collections.list(), (existing) => {
        // Cache not populated yet (no SSR seed / never read) — let the paired invalidate fetch it fresh.
        if (!existing) return existing
        const index = existing.findIndex((c) => c.id === collection.id)
        if (index === -1) return [...existing, collection]
        const next = [...existing]
        next[index] = collection
        return next
      })
    },
    [queryClient],
  )
}

export function useRemoveCollectionQuery() {
  const queryClient = useQueryClient()
  return useCallback(
    (id: string) => void queryClient.removeQueries({ queryKey: queryKeys.collections.detail(id) }),
    [queryClient],
  )
}

/**
 * The single source of truth for applying a saved collection to the shared caches on mutation success:
 * seeds the list cache synchronously so dependent readers (sidebar, grids, the Brain Dump picker) show
 * it immediately, then invalidates for background reconciliation. On create (`isCreate`), also busts
 * `/profile/me` because a new collection can flip the free-tier `canCreateCollection` flag. Used by both
 * `CollectionFormDialog` and `CreateItemDialog`'s inline create so the rule can't drift between them.
 */
export function useApplyCollectionSave() {
  const upsertCollectionCache = useUpsertCollectionCache()
  const invalidate = useInvalidate()
  return useCallback(
    (collection: CollectionWithTypes | null | undefined, opts?: { isCreate?: boolean }) => {
      if (collection) upsertCollectionCache(collection)
      invalidate('collections')
      if (opts?.isCreate) invalidate('userProfile')
    },
    [upsertCollectionCache, invalidate],
  )
}
