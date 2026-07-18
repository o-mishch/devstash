import type { ReactNode } from 'react'
import type { LightItem } from '@/client'
import { ItemRow } from '@/components/dashboard/item-row'

interface DashboardItemListProps {
  items: LightItem[]
}

/**
 * Headless pinned list (no card chrome) — the skins wrap it in their own panel styling. Renders
 * nothing when empty. In the SPA the pinned set is already resolved by `useDashboardData` (derived
 * from the pin-first `recent` query), so no store/override merge is needed here.
 */
export function DashboardPinnedItems({ items }: DashboardItemListProps): ReactNode {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
    </div>
  )
}

/** Headless recent list (no card chrome) — the most recent items, already capped by the hook. */
export function DashboardRecentItems({ items }: DashboardItemListProps): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
    </div>
  )
}
