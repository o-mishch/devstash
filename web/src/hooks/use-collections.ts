import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import {
  createCollectionMutation,
  getCollectionOptions,
  getStatsOptions,
  listCollectionsOptions,
  setCollectionFavoriteMutation,
} from '@/client/@tanstack/react-query.gen'
import type {
  CollectionWithTypes,
  CreateCollectionData,
  ErrorModel,
  Options,
  SetCollectionFavoriteData,
} from '@/client'
import { toast } from 'sonner'
import { heyApiKeyIs } from '@/lib/query-keys'
import { apiErrorStatus, toastMutationError } from '@/lib/api/errors'
import { favoriteToggleMessage } from '@/lib/utils'

export function useCollections(): UseQueryResult<CollectionWithTypes[] | null, ErrorModel> {
  return useQuery(listCollectionsOptions())
}

/**
 * A single collection. Only a 404 is reported to the caller as `isError` — anything else
 * (5xx, network) is THROWN to the route's errorComponent, which offers a retry.
 *
 * The distinction matters: "this collection was deleted" and "the API hiccuped" are different
 * claims about the user's data, and a scale-to-zero cold start makes a transient 5xx on first
 * navigation realistic. The policy lives here, next to the query, so no component has to
 * re-derive it from a boolean that cannot express the difference.
 */
export function useCollection(id: string): UseQueryResult<CollectionWithTypes, ErrorModel> {
  return useQuery({
    ...getCollectionOptions({ path: { id } }),
    throwOnError: (error) => apiErrorStatus(error) !== 404,
  })
}

/** Create a collection; refreshes the collections list and the stats totals. */
export function useCreateCollection(): UseMutationResult<
  CollectionWithTypes,
  ErrorModel,
  Options<CreateCollectionData>
> {
  const queryClient = useQueryClient()
  return useMutation({
    ...createCollectionMutation(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listCollectionsOptions().queryKey })
      void queryClient.invalidateQueries({ queryKey: getStatsOptions().queryKey })
      toast.success('Collection created')
    },
    onError: toastMutationError,
  })
}

export function useToggleCollectionFavorite(): UseMutationResult<
  void,
  ErrorModel,
  Options<SetCollectionFavoriteData>
> {
  const queryClient = useQueryClient()
  return useMutation({
    ...setCollectionFavoriteMutation(),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        predicate: (q) => heyApiKeyIs(q.queryKey, 'listCollections', 'getCollection'),
        refetchType: 'active',
      })
      toast.success(favoriteToggleMessage(variables.body.isFavorite))
    },
    onError: toastMutationError,
  })
}
