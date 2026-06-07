import { useLayoutEffect, useMemo, useRef } from 'react'
import { useItemsStore, ItemsStoreActionType } from '@/context/items-store-context'
import type { ItemsPage } from '@/types/item'

function getFirstPageSignature(firstPage: ItemsPage): string {
  return JSON.stringify({
    itemIds: firstPage.items.map((item) => item.id),
    nextCursor: firstPage.nextCursor,
    hasMore: firstPage.hasMore,
  })
}

export function useInfiniteScrollSync(pageKey: string, firstPage: ItemsPage) {
  const { state, dispatch } = useItemsStore()
  const lastFirstPageSignature = useRef<string | null>(null)
  const firstPageSignature = useMemo(() => getFirstPageSignature(firstPage), [firstPage])

  useLayoutEffect(() => {
    const firstPageChanged = lastFirstPageSignature.current !== firstPageSignature

    if (state.pageKey !== pageKey || firstPageChanged) {
      dispatch({
        type: ItemsStoreActionType.Reset,
        pageKey,
        items: firstPage.items,
        cursor: firstPage.nextCursor,
        hasMore: firstPage.hasMore,
      })
      lastFirstPageSignature.current = firstPageSignature
    }
  }, [firstPage, dispatch, firstPageSignature, pageKey, state.pageKey])

  const isActive = state.pageKey === pageKey
  const hasMore = isActive ? state.hasMore : firstPage.hasMore
  const loading = isActive ? state.loading : false
  const items = isActive ? state.items : firstPage.items

  return { items, hasMore, loading, state, dispatch, isActive }
}
