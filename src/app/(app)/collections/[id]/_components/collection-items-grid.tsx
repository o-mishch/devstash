'use client'

import { useInfiniteItemsFetch } from '@/hooks/use-infinite-items-fetch'
import { VirtualImageGrid } from '@/components/items/virtual-image-grid'
import { VirtualItemGrid } from '@/components/items/virtual-item-grid'
import { VirtualFileList } from '@/components/items/virtual-file-list'
import { ItemCard } from '@/components/items/item-card'
import { ImageCard } from '@/components/items/image-card'
import { EmptyCard } from '@/components/shared/empty-card'
import { ITEM_TYPES_WITH_IMAGE_GRID, ITEM_TYPES_WITH_FILE_LIST } from '@/lib/utils/constants'
import type { ItemsPage } from '@/types/item'

interface CollectionItemsGridProps {
  collectionId: string
  firstPage: ItemsPage
}

export function CollectionItemsGrid({ collectionId, firstPage }: CollectionItemsGridProps) {
  const pageKey = `collection:${collectionId}`
  const { items, fetchMore } = useInfiniteItemsFetch(pageKey, firstPage, { type: 'collection', collectionId })

  if (items.length === 0) {
    return <EmptyCard message="No items in this collection yet." />
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
