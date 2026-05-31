'use client'

import { useCallback } from 'react'
import { useInfiniteScrollSync } from '@/hooks/use-infinite-scroll-sync'
import { ItemsStoreActionType } from '@/context/items-store-context'
import { VirtualImageGrid } from '@/components/items/virtual-image-grid'
import { VirtualItemGrid } from '@/components/items/virtual-item-grid'
import { VirtualFileList } from '@/components/items/virtual-file-list'
import { EmptyCard } from '@/components/shared/empty-card'
import { ITEM_TYPES_WITH_IMAGE_GRID, ITEM_TYPES_WITH_FILE_LIST } from '@/lib/utils/constants'
import { fetchMoreItemsAction } from '@/actions/items'
import type { ItemsPage } from '@/types/item'

interface ItemsGridProps {
  firstPage: ItemsPage
  typeName: string
}

export function ItemsGrid({ firstPage, typeName }: ItemsGridProps) {
  const pageKey = `type:${typeName}`
  const { items, state, dispatch } = useInfiniteScrollSync(pageKey, firstPage)

  const fetchMore = useCallback(async () => {
    const cursor = state.pageKey === pageKey ? state.cursor : null
    if (!cursor) return

    dispatch({ type: ItemsStoreActionType.SetLoading, loading: true })
    const result = await fetchMoreItemsAction({ type: 'type', typeName }, cursor)

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
  }, [state.pageKey, state.cursor, typeName, pageKey, dispatch])

  if (items.length === 0) {
    return <EmptyCard message={`No ${typeName}s yet.`} />
  }

  if (ITEM_TYPES_WITH_IMAGE_GRID.has(typeName)) {
    return <VirtualImageGrid pageKey={pageKey} onFetchMore={fetchMore} />
  }
  if (ITEM_TYPES_WITH_FILE_LIST.has(typeName)) {
    return <VirtualFileList pageKey={pageKey} onFetchMore={fetchMore} />
  }
  return <VirtualItemGrid pageKey={pageKey} onFetchMore={fetchMore} />
}
