import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import type { ErrorModel, ItemsPage } from '@/client'
import { flattenItems } from '@/hooks/use-items'
import { ItemCard } from './item-card'
import { VirtualItemGrid } from './virtual-item-grid'
import { EmptyState } from '@/components/app/empty-state'
import { CardGridStates, GridErrorBox, GridSkeleton } from '@/components/app/grid-states'

interface ItemListEmpty {
  icon: LucideIcon
  title: string
  description?: string
}

interface ItemListProps {
  query: UseInfiniteQueryResult<InfiniteData<ItemsPage>, ErrorModel>
  empty: ItemListEmpty
  /** Dashboard glance preview: a static capped grid (no virtualization / infinite scroll). The row
   *  cap is the query's own `limit`. */
  preview?: boolean
}

export function ItemList({ query, empty, preview }: ItemListProps): ReactNode {
  const items = flattenItems(query.data)
  const emptyState = (
    <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
  )

  // Preview (dashboard): a small fixed slice never worth virtualizing — render the shared card grid.
  if (preview === true) {
    return (
      <CardGridStates
        isPending={query.isPending}
        isError={query.isError}
        errorLabel="items"
        isEmpty={items.length === 0}
        emptyState={emptyState}
        tileClassName="h-40"
      >
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </CardGridStates>
    )
  }

  // Full page: the list can be large, so window-virtualize it. The state ladder mirrors
  // CardGridStates, but the populated case is the virtual grid rather than a static CARD_GRID.
  if (query.isPending) return <GridSkeleton tileClassName="h-40" />
  if (query.isError) return <GridErrorBox label="items" />
  if (items.length === 0) return emptyState

  return (
    <VirtualItemGrid
      items={items}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      fetchNextPageError={query.isFetchNextPageError}
      fetchNextPage={() => void query.fetchNextPage()}
    />
  )
}
