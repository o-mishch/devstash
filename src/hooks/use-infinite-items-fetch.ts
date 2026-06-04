import { useCallback } from 'react'
import { useInfiniteScrollSync } from './use-infinite-scroll-sync'
import { ItemsStoreActionType } from '@/context/items-store-context'
import { fetchMoreItemsAction } from '@/actions/items'
import type { ItemsPage } from '@/types/item'

type FetchItemsParams = Parameters<typeof fetchMoreItemsAction>[0]

export function useInfiniteItemsFetch(pageKey: string, firstPage: ItemsPage, fetchParams: FetchItemsParams) {
  const { items, hasMore, loading, state, dispatch } = useInfiniteScrollSync(pageKey, firstPage)
  const fetchParamsStr = JSON.stringify(fetchParams)

  const fetchMore = useCallback(async () => {
    const cursor = state.pageKey === pageKey ? state.cursor : null
    if (!cursor) return

    dispatch({ type: ItemsStoreActionType.SetLoading, loading: true })
    
    const params = JSON.parse(fetchParamsStr) as FetchItemsParams
    const result = await fetchMoreItemsAction(params, cursor)

    if (result.status === 'ok' && result.data) {
      dispatch({
        type: ItemsStoreActionType.AppendPage,
        items: result.data.items,
        cursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      })
    } else {
      dispatch({ type: ItemsStoreActionType.SetLoading, loading: false })
    }
  }, [state.pageKey, state.cursor, pageKey, dispatch, fetchParamsStr])

  return { items, hasMore, loading, fetchMore }
}
