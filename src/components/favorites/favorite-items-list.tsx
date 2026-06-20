'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { useInfiniteItems } from '@/hooks/use-infinite-items'
import { useAutoFetchNextPage } from '@/hooks/use-auto-fetch-next-page'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { Skeleton } from '@/components/ui/skeleton'
import { FavoriteItemRow } from './favorite-item-row'
import { compareBySystemTypeOrder, SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import type { ItemsPage, LightItem, SlimItemType } from '@/types/item'

interface ItemGroup {
  itemType: SlimItemType
  items: LightItem[]
}

function groupByType(items: LightItem[]): ItemGroup[] {
  const map = new Map<string, ItemGroup>()
  for (const item of items) {
    const existing = map.get(item.itemType.name)
    if (existing) {
      existing.items.push(item)
    } else {
      map.set(item.itemType.name, { itemType: item.itemType, items: [item] })
    }
  }
  return Array.from(map.values())
}

interface FavoriteItemsListProps {
  firstPage: ItemsPage
  itemTypeCounts: Record<string, number>
}

export function FavoriteItemsList({ firstPage, itemTypeCounts }: FavoriteItemsListProps) {
  const { openDrawer } = useItemDrawerStore()
  const { items, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteItems({ type: 'favorites' }, firstPage)
  const { sentinelRef } = useAutoFetchNextPage(hasNextPage, isFetchingNextPage, fetchNextPage)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const groups = useMemo(
    () => groupByType(items).sort((a, b) => compareBySystemTypeOrder(a.itemType, b.itemType)),
    [items]
  )

  const toggleGroup = useCallback((typeName: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(typeName)) next.delete(typeName)
      else next.add(typeName)
      return next
    })
  }, [])

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {groups.map(({ itemType, items: groupItems }) => {
        const color = SYSTEM_TYPE_COLORS[itemType.name]
        const isCollapsed = collapsed.has(itemType.name)
        return (
          <div key={itemType.name}>
            {/* Group header */}
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => toggleGroup(itemType.name)}
              className="flex w-full items-center gap-2 rounded px-3 py-1 text-left transition-colors hover:bg-foreground/[0.04] touch:py-2"
            >
              <ChevronRight
                className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 touch:size-4"
                style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
              />
              <ItemTypeIcon typeName={itemType.name} className="size-3 shrink-0 touch:size-4" />
              <span className="font-mono text-xs font-medium capitalize touch:text-sm" style={{ color }}>
                {itemType.name}
              </span>
              <span
                className="rounded px-1 font-mono text-[10px]"
                style={{ color, backgroundColor: `${color}15` }}
              >
                {itemTypeCounts[itemType.name] !== undefined && groupItems.length < itemTypeCounts[itemType.name]
                  ? `${groupItems.length} / ${itemTypeCounts[itemType.name]}`
                  : groupItems.length}
              </span>
            </button>

            {/* Group items */}
            {!isCollapsed && (
              <div className="mt-1 flex flex-col gap-1.5 pl-4">
                {groupItems.map((item) => (
                  <FavoriteItemRow key={item.id} item={item} onOpen={openDrawer} />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {hasNextPage && <div ref={sentinelRef} className="h-px" aria-hidden="true" />}
      {isFetchingNextPage && (
        <div className="flex flex-col gap-1.5 pl-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="app-row gap-3 rounded-xl border-l-2 border-l-border bg-card px-3 py-2 ring-1 ring-border touch:py-3">
              <Skeleton className="size-3.5 touch:size-5 shrink-0 rounded" />
              <Skeleton className="h-4 touch:h-5 min-w-0 flex-1" />
              <Skeleton className="hidden sm:block h-4 w-14 shrink-0 rounded" />
              <Skeleton className="hidden md:block h-4 w-16 shrink-0 rounded" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
