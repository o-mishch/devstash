'use client'

import { useCallback } from 'react'
import { useInfiniteScrollSync } from '@/hooks/use-infinite-scroll-sync'
import { ItemsStoreActionType } from '@/context/items-store-context'
import { VirtualImageGrid } from '@/components/items/virtual-image-grid'
import { VirtualItemGrid } from '@/components/items/virtual-item-grid'
import { VirtualFileList } from '@/components/items/virtual-file-list'
import { ItemCard } from '@/components/items/item-card'
import { ImageCard } from '@/components/items/image-card'
import { Card, CardContent } from '@/components/ui/card'
import { ITEM_TYPES_WITH_IMAGE_GRID, ITEM_TYPES_WITH_FILE_LIST } from '@/lib/utils/constants'
import { fetchMoreItemsAction } from '@/actions/items'
import type { ItemsPage } from '@/types/item'

interface CollectionItemsGridProps {
  collectionId: string
  firstPage: ItemsPage
}

export function CollectionItemsGrid({ collectionId, firstPage }: CollectionItemsGridProps) {
  const pageKey = `collection:${collectionId}`
  const { items, state, dispatch } = useInfiniteScrollSync(pageKey, firstPage)

  const fetchMore = useCallback(async () => {
    const cursor = state.pageKey === pageKey ? state.cursor : null
    if (!cursor) return

    dispatch({ type: ItemsStoreActionType.SetLoading, loading: true })
    const result = await fetchMoreItemsAction({ type: 'collection', collectionId }, cursor)

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
  }, [state.pageKey, state.cursor, collectionId, pageKey, dispatch])

  if (items.length === 0) {
    return (
      <Card className="h-20">
        <CardContent className="flex h-full items-center justify-center p-4">
          <p className="text-sm text-muted-foreground">No items in this collection yet.</p>
        </CardContent>
      </Card>
    )
  }

  const uniqueTypeCount = new Set(items.map((i) => i.itemType.name)).size

  if (uniqueTypeCount === 1) {
    const typeName = items[0].itemType.name
    if (ITEM_TYPES_WITH_IMAGE_GRID.has(typeName)) return <VirtualImageGrid pageKey={pageKey} onFetchMore={fetchMore} />
    if (ITEM_TYPES_WITH_FILE_LIST.has(typeName)) return <VirtualFileList pageKey={pageKey} onFetchMore={fetchMore} />
    return <VirtualItemGrid pageKey={pageKey} onFetchMore={fetchMore} />
  }

  // Mixed types: non-virtualized grid (variable row heights)
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        if (ITEM_TYPES_WITH_IMAGE_GRID.has(item.itemType.name)) {
          return <ImageCard key={item.id} item={item} />
        }
        return <ItemCard key={item.id} item={item} />
      })}
    </div>
  )
}
