import { skipToken, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { getItemContentOptions, getItemDetailsOptions } from '@/client/@tanstack/react-query.gen'
import type { ErrorModel, ItemContent, ItemDetails } from '@/client'

/**
 * The item drawer's progressive fetch: a light row opens the drawer instantly, then its extra
 * detail (description, collections, updatedAt) and heavy content stream in. Both are gated on the
 * drawer being open for the item, so closed rows cost nothing.
 *
 * When there is no real `id` (drawer closed / nothing selected), `queryFn` is TanStack's
 * `skipToken` rather than the generated fetcher — the query can never actually be EXECUTED
 * against a placeholder id. The placeholder only shapes an inert cache key, never reaches the
 * network: `skipToken` disables the query outright, both at runtime and in its types.
 */
export function useItemDetails(
  id: string | null,
  enabled: boolean,
): UseQueryResult<ItemDetails, ErrorModel> {
  const { queryKey, queryFn } = getItemDetailsOptions({ path: { id: id ?? '' } })
  return useQuery({
    queryKey,
    queryFn: enabled && id !== null ? queryFn : skipToken,
    staleTime: 30 * 1000,
  })
}

/** The item's full stored content + language (only the content-bearing types fetch this). */
export function useItemContent(
  id: string | null,
  enabled: boolean,
): UseQueryResult<ItemContent, ErrorModel> {
  const { queryKey, queryFn } = getItemContentOptions({ path: { id: id ?? '' } })
  return useQuery({
    queryKey,
    queryFn: enabled && id !== null ? queryFn : skipToken,
    staleTime: 30 * 1000,
  })
}
