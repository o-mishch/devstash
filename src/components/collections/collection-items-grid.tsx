'use client'

import { useInfiniteItems } from '@/hooks/items/use-infinite-items'
import { ItemCard } from '@/components/items/item-card'
import { ImageCard } from '@/components/items/image-card'
import { EmptyCard } from '@/components/shared/empty-card'
import { ITEM_TYPES_WITH_IMAGE_GRID } from '@/lib/utils/constants'
import { triggerCreateItemButton } from '@/lib/dom/create-item-trigger'
import type { ItemsPage } from '@/types/item'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

interface CollectionItemsGridProps {
  collectionId: string
  firstPage: ItemsPage
}

export function CollectionItemsGrid({ collectionId, firstPage }: CollectionItemsGridProps) {
  const { items, hasNextPage, fetchNextPage } = useInfiniteItems({ type: 'collection', collectionId }, firstPage)

  if (items.length === 0) {
    return (
      <EmptyCard
        action={
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={triggerCreateItemButton}
          >
            Create your first item <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        }
      />
    )
  }

  // Mixed types or single type: render grid with load more button
  return (
    <div className="flex flex-col gap-4">
      <div className="app-grid card-grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => {
          if (ITEM_TYPES_WITH_IMAGE_GRID.has(item.itemType.name)) {
            return <ImageCard key={item.id} item={item} priority={index < 8} />
          }
          return <ItemCard key={item.id} item={item} />
        })}
      </div>
      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
