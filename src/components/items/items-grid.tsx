'use client'

import { useCallback, useMemo } from 'react'
import { useInfiniteItems } from '@/hooks/items/use-infinite-items'
import { TanStackVirtualGrid, singleColumn } from '@/components/items/tanstack-virtual-grid'
import { ItemCard } from '@/components/items/item-card'
import { ImageCard } from '@/components/items/image-card'
import { FileRow } from '@/components/items/file-row'
import { EmptyCard } from '@/components/shared/empty-card'
import { ItemsTypeSkeleton } from '@/components/shared/skeletons'
import { ITEM_TYPES_WITH_IMAGE_GRID, ITEM_TYPES_WITH_FILE_LIST } from '@/lib/utils/constants'
import { getListGridColumns, getImageGridColumns } from '@/lib/utils/ui'
import { triggerCreateItemButton } from '@/lib/dom/create-item-trigger'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import type { LightItem } from '@/types/item'

interface ItemsGridProps {
  typeName: string
  typeLabel: string
}

// Module-level render functions: none close over per-render props/state, so hoisting them keeps
// the `renderItem` reference passed to TanStackVirtualGrid stable across ItemsGrid re-renders.
function renderImageItem(item: LightItem, index: number) {
  return <ImageCard item={item} priority={index < 12} />
}

function renderFileItem(item: LightItem) {
  return <FileRow item={item} />
}

function renderListItem(item: LightItem) {
  return <ItemCard item={item} />
}

export function ItemsGrid({ typeName, typeLabel }: ItemsGridProps) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteItems({ type: 'type', typeName })

  // Stable reference: VirtualGridBody reads onLoadMore from its infinite-scroll effect's dependency
  // array, so a fresh function identity on every ItemsGrid render would re-run that effect needlessly.
  const onLoadMore = useCallback(() => { void fetchNextPage() }, [fetchNextPage])

  // Hoisted above the early returns (Rules of Hooks) even though it's only rendered in the
  // zero-items branch below.
  const emptyAction = useMemo(
    () => (
      <Button
        variant="ghost"
        className="text-muted-foreground hover:text-foreground"
        onClick={triggerCreateItemButton}
      >
        Create your first {typeName} <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    ),
    [typeName],
  )

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
        <EmptyCard action={emptyAction} />
      </>
    )
  }

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
          renderItem={renderImageItem}
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
          renderItem={renderFileItem}
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
        renderItem={renderListItem}
      />
    </>
  )
}
