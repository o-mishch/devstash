import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { fetchMoreItemsAction } from '@/actions/items'
import type { FetchItemsQuery, ItemsPage, LightItem } from '@/types/item'

export function useInfiniteItems(
  fetchParams: FetchItemsQuery,
  initialData?: ItemsPage
) {
  const query = useInfiniteQuery({
    queryKey: ['items', JSON.stringify(fetchParams)],
    queryFn: async ({ pageParam }) => {
      const result = await fetchMoreItemsAction(fetchParams, pageParam as string | undefined)
      if (result.status !== 'ok' || !result.data) {
        throw new Error(result.message || 'Failed to fetch items')
      }
      return result.data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    ...(initialData && { initialData: { pages: [initialData], pageParams: [null] } }),
  })

  const items: LightItem[] = useMemo(
    () => query.data?.pages.flatMap(page => page.items) ?? [],
    [query.data?.pages]
  )

  return { ...query, items }
}
