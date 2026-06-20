'use client'

import { useMemo } from 'react'
import { ItemRow } from '@/components/dashboard/item-row'
import { usePinnedItemsStore, type PinnedOverride } from '@/stores/pinned-items'
import type { LightItem } from '@/types/item'

// Cap on pinned items shown on the dashboard across all skins — a short, fixed list (same pattern
// as recent items).
const PINNED_ITEMS_LIMIT = 5

// Single source of truth for "what is pinned right now": the server-provided items with the live
// pin/unpin overrides applied, capped to the dashboard limit. Both the card wrapper (emptiness
// check) and the headless list (rendering) derive from this so the two can't drift.
export function mergePinnedItems(
  initialItems: LightItem[],
  overrides: Map<string, PinnedOverride>,
): LightItem[] {
  const result = new Map<string, LightItem>(initialItems.map((i) => [i.id, i]))
  overrides.forEach(({ item, pinned }, id) => {
    if (pinned) result.set(id, { ...item, isPinned: true })
    else result.delete(id)
  })
  return [...result.values()].slice(0, PINNED_ITEMS_LIMIT)
}

interface DashboardPinnedItemsProps {
  initialItems: LightItem[]
}

// Headless pinned list (no card chrome) — applies the live pin/unpin overrides on top of the
// server-provided items. Consumed by the classic collapsible card and by the dashboard skins,
// which wrap it in their own panel styling. Renders nothing when there are no pinned items.
export function DashboardPinnedItems({ initialItems }: DashboardPinnedItemsProps) {
  const overrides = usePinnedItemsStore((s) => s.overrides)
  const items = useMemo(() => mergePinnedItems(initialItems, overrides), [initialItems, overrides])

  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-[12px]">
      {items.map((item) => <ItemRow key={item.id} item={item} />)}
    </div>
  )
}
