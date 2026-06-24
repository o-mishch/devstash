'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, queryKeyMatches } from '@/lib/api/query-keys'

// [C] CLIENT-ONLY (src/hooks is front-end by design). Central client-cache invalidation registry — the
// client-side MIRROR of the server `CacheTags` / `invalidate*Cache` model (`src/lib/infra/cache.ts` [S]),
// deliberately kept as a separate package so the two cache layers never cross the FE/BE boundary: a server
// mutation busts Next.js cache tags via `invalidate*Cache(userId)`; a client mutation busts TanStack
// queries via this `invalidate(entity)`. ONE place turns "this entity changed" into the right TanStack
// fan-out, so a mutation never re-derives which keys to bust; the per-domain `useInvalidate*` hooks delegate
// here, routing every client invalidation through this single switch.

/** Cache entities a mutation can invalidate. Extend here (one case) when a new cached entity is added. */
export type CacheEntity =
  | 'items'
  | 'brainDumpJobs'
  | 'brainDumpSources'
  | 'aiUsage'
  | 'collections'
  | 'billingContext'
  | 'profile'
  | 'userProfile'

export interface InvalidateOptions {
  // Mirror of TanStack's `refetchType`. 'none' marks stale without refetching (lets a server-side
  // revalidateTag that runs via after() win the race); 'all' also refetches INACTIVE queries (needed
  // when the affected list is unmounted at mutation time, e.g. the dashboard while the drawer is open).
  refetchType?: 'active' | 'inactive' | 'all' | 'none'
}

/**
 * Returns `invalidate(entity, options?)` — the single entry point for client-cache invalidation.
 * Fire-and-forget; with the default `refetchType: 'active'` an entity whose query is unmounted is a true
 * no-op, so callers invoke it unconditionally.
 */
export function useInvalidate() {
  const queryClient = useQueryClient()
  return useCallback(
    (entity: CacheEntity, options?: InvalidateOptions) => {
      const refetch = options?.refetchType ? { refetchType: options.refetchType } : {}
      switch (entity) {
        case 'items':
          void queryClient.invalidateQueries({ queryKey: queryKeys.items.root, ...refetch })
          return
        case 'brainDumpJobs':
          void queryClient.invalidateQueries({
            predicate: (query) => queryKeyMatches.brainDumpJobs(query.queryKey),
            ...refetch,
          })
          return
        case 'brainDumpSources':
          void queryClient.invalidateQueries({
            predicate: (query) => queryKeyMatches.brainDumpSources(query.queryKey),
            ...refetch,
          })
          return
        case 'aiUsage':
          void queryClient.invalidateQueries({ queryKey: queryKeys.aiUsage(), ...refetch })
          return
        case 'collections':
          void queryClient.invalidateQueries({
            predicate: (query) => queryKeyMatches.collections(query.queryKey),
            ...refetch,
          })
          return
        case 'billingContext':
          void queryClient.invalidateQueries({ queryKey: queryKeys.billingContext(), ...refetch })
          return
        case 'profile':
          void queryClient.invalidateQueries({ queryKey: queryKeys.profile(), ...refetch })
          return
        case 'userProfile':
          void queryClient.invalidateQueries({ queryKey: queryKeys.userProfile(), ...refetch })
          return
      }
    },
    [queryClient],
  )
}
