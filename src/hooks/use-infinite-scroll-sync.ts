import { useLayoutEffect } from 'react'
import { useItemsStore, ItemsStoreActionType } from '@/context/items-store-context'
import type { ItemsPage } from '@/types/item'

export function useInfiniteScrollSync(pageKey: string, firstPage: ItemsPage) {
  const { state, dispatch } = useItemsStore()

  useLayoutEffect(() => {
    if (state.pageKey !== pageKey) {
      dispatch({
        type: ItemsStoreActionType.Reset,
        pageKey,
        items: firstPage.items,
        cursor: firstPage.nextCursor,
        hasMore: firstPage.hasMore,
      })
    }
  }, [firstPage, dispatch, pageKey, state.pageKey])

  const isActive = state.pageKey === pageKey
  const hasMore = isActive ? state.hasMore : firstPage.hasMore
  const loading = isActive ? state.loading : false
  const items = isActive ? state.items : firstPage.items

  return { items, hasMore, loading, state, dispatch, isActive }
}
