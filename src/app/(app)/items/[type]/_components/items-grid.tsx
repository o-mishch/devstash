'use client'

import { useInfiniteItemsFetch } from '@/hooks/use-infinite-items-fetch'
import { VirtualImageGrid } from '@/components/items/virtual-image-grid'
import { VirtualItemGrid } from '@/components/items/virtual-item-grid'
import { VirtualFileList } from '@/components/items/virtual-file-list'
import { EmptyCard } from '@/components/shared/empty-card'
import { ITEM_TYPES_WITH_IMAGE_GRID, ITEM_TYPES_WITH_FILE_LIST } from '@/lib/utils/constants'
import type { ItemsPage } from '@/types/item'

interface ItemsGridProps {
  firstPage: ItemsPage
  typeName: string
}

export function ItemsGrid({ firstPage, typeName }: ItemsGridProps) {
  const pageKey = `type:${typeName}`
  const { items, fetchMore } = useInfiniteItemsFetch(pageKey, firstPage, { type: 'type', typeName })

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
