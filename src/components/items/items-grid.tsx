'use client'

import { useInfiniteItems } from '@/hooks/use-infinite-items'
import { TanStackVirtualGrid, singleColumn } from '@/components/items/tanstack-virtual-grid'
import { ItemCard } from '@/components/items/item-card'
import { ImageCard } from '@/components/items/image-card'
import { FileRow } from '@/components/items/file-row'
import { EmptyCard } from '@/components/shared/empty-card'
import { ItemsTypeSkeleton } from '@/components/shared/skeletons'
import { ITEM_TYPES_WITH_IMAGE_GRID, ITEM_TYPES_WITH_FILE_LIST } from '@/lib/utils/constants'
import { getListGridColumns, getImageGridColumns } from '@/lib/utils/ui'
import { triggerCreateItemButton } from '@/lib/utils/ui'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

interface ItemsGridProps {
  typeName: string
  typeLabel: string
}

export function ItemsGrid({ typeName, typeLabel }: ItemsGridProps) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteItems({ type: 'type', typeName })

  const displayCount = !isLoading ? (hasNextPage ? `${items.length}+` : String(items.length)) : null

  const heading = (
    <h1 className="text-xl font-semibold">
      {typeLabel}
      {displayCount !== null && <span className="text-muted-foreground font-normal text-lg"> ({displayCount})</span>}
    </h1>
  )

  if (isLoading && items.length === 0) {
    return <>{heading}<ItemsTypeSkeleton typeName={typeName} /></>
  }

  if (items.length === 0) {
    return (
      <>
        {heading}
        <EmptyCard
          action={
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={triggerCreateItemButton}
            >
              Create your first {typeName} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          }
        />
      </>
    )
  }

  const onLoadMore = () => { void fetchNextPage() }
  const hasMore = hasNextPage ?? false

  if (ITEM_TYPES_WITH_IMAGE_GRID.has(typeName)) {
    return (
      <>
        {heading}
        <TanStackVirtualGrid
          items={items}
          hasMore={hasMore}
          isLoading={isFetchingNextPage}
          onLoadMore={onLoadMore}
          getColumns={getImageGridColumns}
          itemHeight={240}
          columnGap={12}
          rowGap={12}
          renderItem={(item, index) => <ImageCard item={item} priority={index < 12} />}
        />
      </>
    )
  }
  if (ITEM_TYPES_WITH_FILE_LIST.has(typeName)) {
    return (
      <>
        {heading}
        <TanStackVirtualGrid
          items={items}
          hasMore={hasMore}
          isLoading={isFetchingNextPage}
          onLoadMore={onLoadMore}
          getColumns={singleColumn}
          itemHeight={48}
          touchItemHeight={64}
          columnGap={0}
          rowGap={10}
          renderItem={(item) => <FileRow item={item} />}
        />
      </>
    )
  }
  return (
    <>
      {heading}
      <TanStackVirtualGrid
        items={items}
        hasMore={hasMore}
        isLoading={isFetchingNextPage}
        onLoadMore={onLoadMore}
        getColumns={getListGridColumns}
        itemHeight={100}
        touchItemHeight={96}
        columnGap={16}
        rowGap={14}
        renderItem={(item) => <ItemCard item={item} />}
      />
    </>
  )
}
