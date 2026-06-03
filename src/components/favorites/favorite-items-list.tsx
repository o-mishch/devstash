'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useInfiniteScrollSync } from '@/hooks/use-infinite-scroll-sync'
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'
import { useItemDrawer } from '@/context/item-drawer-context'
import { ItemsStoreActionType } from '@/context/items-store-context'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { Skeleton } from '@/components/ui/skeleton'
import { FavoriteItemRow } from './favorite-item-row'
import { fetchMoreItemsAction } from '@/actions/items'
import { compareBySystemTypeOrder } from '@/lib/utils/constants'
import type { ItemsPage, ItemType, LightItem } from '@/types/item'

const PAGE_KEY = 'favorites:items'

interface ItemGroup {
  itemType: ItemType
  items: LightItem[]
}

function groupByType(items: LightItem[]): ItemGroup[] {
  const map = new Map<string, ItemGroup>()
  for (const item of items) {
    const existing = map.get(item.itemType.id)
    if (existing) {
      existing.items.push(item)
    } else {
      map.set(item.itemType.id, { itemType: item.itemType, items: [item] })
    }
  }
  return Array.from(map.values())
}

interface FavoriteItemsListProps {
  firstPage: ItemsPage
  itemTypeCounts: Record<string, number>
}

export function FavoriteItemsList({ firstPage, itemTypeCounts }: FavoriteItemsListProps) {
  const { openDrawer } = useItemDrawer()
  const { items, hasMore, loading, state, dispatch } = useInfiniteScrollSync(PAGE_KEY, firstPage)
  const { ref, inView } = useIntersectionObserver({ rootMargin: '200px' })
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const groups = useMemo(
    () => groupByType(items).sort((a, b) => compareBySystemTypeOrder(a.itemType, b.itemType)),
    [items]
  )

  const toggleGroup = useCallback((typeId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(typeId)) next.delete(typeId)
      else next.add(typeId)
      return next
    })
  }, [])

  const fetchMore = useCallback(async () => {
    const cursor = state.pageKey === PAGE_KEY ? state.cursor : null
    if (!cursor) return

    dispatch({ type: ItemsStoreActionType.SetLoading, loading: true })
    const result = await fetchMoreItemsAction({ type: 'favorites' }, cursor)

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
  }, [state.pageKey, state.cursor, dispatch])

  useEffect(() => {
    if (inView && hasMore && !loading) {
      void fetchMore()
    }
  }, [inView, hasMore, loading, fetchMore])

  return (
    <div className="flex flex-col gap-1">
      {groups.map(({ itemType, items: groupItems }) => {
        const isCollapsed = collapsed.has(itemType.id)
        return (
          <div key={itemType.id}>
            {/* Group header */}
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => toggleGroup(itemType.id)}
              className="flex w-full items-center gap-2 rounded px-3 py-1 text-left transition-colors hover:bg-foreground/[0.04]"
            >
              <ChevronRight
                className="size-3 shrink-0 text-muted-foreground transition-transform duration-150"
                style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
              />
              <ItemTypeIcon iconName={itemType.icon} color={itemType.color} className="size-3 shrink-0" />
              <span
                className="font-mono text-xs font-medium capitalize"
                style={{ color: itemType.color }}
              >
                {itemType.name}
              </span>
              <span
                className="rounded px-1 font-mono text-[10px]"
                style={{ color: itemType.color, backgroundColor: `${itemType.color}15` }}
              >
                {(() => {
                  const total = itemTypeCounts[itemType.id]
                  return total !== undefined && groupItems.length < total
                    ? `${groupItems.length} / ${total}`
                    : groupItems.length
                })()}
              </span>
            </button>

            {/* Group items */}
            {!isCollapsed && (
              <div className="pl-4">
                {groupItems.map((item) => (
                  <FavoriteItemRow key={item.id} item={item} onOpen={openDrawer} />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {hasMore && <div ref={ref} className="h-px" aria-hidden="true" />}
      {loading && (
        <div className="flex flex-col pl-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-1.5">
              <Skeleton className="size-3.5 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
