'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { $api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { useInvalidate } from '@/hooks/items/use-cache-invalidation'
import type { UserProfileFlagsResponse } from '@/lib/api/schemas/profile'

interface UseUserProfileOptions {
  initialData?: UserProfileFlagsResponse
}

export function useUserProfile(options?: UseUserProfileOptions) {
  // SSR-seeded by AppUserFlagsInitializer and mutated optimistically by usePatchUserProfile. Keep it
  // enabled so limit-changing mutations can invalidate/refetch the canCreate* flags; `staleTime: Infinity`
  // prevents autonomous refetches until a mutation asks for one.
  // init MUST be `undefined` (not `{}`) so the observed key is `['get','/profile/me']` — the exact key
  // the hydrator/patcher write via `setQueryData(queryKeys.userProfile())`. openapi-react-query keys a
  // `{}` init as `['get','/profile/me',{}]`, which an exact-key setQueryData would never reach (the
  // query then never receives the SSR seed → sidebar shows "Guest").
  // `initialData` (passed only by AppUserFlagsInitializer, which renders at the top of the (app) layout)
  // seeds the cache synchronously during render so sibling consumers — useIsPro() in item cards, AI
  // fields, the drawer — read the SSR flags on first paint and never fire a redundant GET /profile/me.
  return $api.useQuery('get', '/profile/me', undefined, { staleTime: Infinity, initialData: options?.initialData })
}

/**
 * The Pro flag resolved against its default — `false` until the cache is seeded. Centralizes the
 * `profile?.isPro ?? false` fallback so the many gating call sites can't drift or forget the default.
 */
export function useIsPro(): boolean {
  return useUserProfile().data?.isPro ?? false
}

/** Seed the user profile cache from SSR-fetched data (called in AppUserFlagsInitializer). */
export function useHydrateUserProfile() {
  const queryClient = useQueryClient()
  return useCallback(
    (data: UserProfileFlagsResponse) => {
      queryClient.setQueryData(queryKeys.userProfile(), data)
    },
    [queryClient],
  )
}

/**
 * Reconcile specific fields in the user-profile cache after a successful mutation. This is a
 * post-success cache writer (callers invoke it in `onSuccess`), not a pre-await optimistic update —
 * there is nothing to roll back. For genuine optimistic-with-rollback, see `useUpdateEditorPreferences`.
 */
export function usePatchUserProfile() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidate()
  return useCallback(
    (patch: Partial<UserProfileFlagsResponse>) => {
      queryClient.setQueryData(
        queryKeys.userProfile(),
        (old: UserProfileFlagsResponse | undefined) => (old ? { ...old, ...patch } : undefined),
      )
      // Mark stale without refetching so a server-normalized value (e.g. a trimmed/transformed name)
      // reconciles on the next focus/navigation — mirrors usePatchProfile. An immediate refetch would
      // race the deferred revalidateTag on the server.
      invalidate('userProfile', { refetchType: 'none' })
    },
    [queryClient, invalidate],
  )
}
