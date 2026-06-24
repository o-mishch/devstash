'use client'

import { ItemRow } from '@/components/dashboard/item-row'
import { useInfiniteItems } from '@/hooks/items/use-infinite-items'
import type { ItemsPage } from '@/types/item'

// Cap on recent items shown on the dashboard across all skins — a short, fixed list (no infinite
// scroll, no virtualization). Browse the full list from the items pages.
const RECENT_ITEMS_LIMIT = 7

interface DashboardRecentItemsProps {
  firstPage: ItemsPage
}

// Headless recent list (no card chrome) — the most recent items, capped. Subscribes to the shared
// `['items', {type:'recent'}]` TanStack query seeded with the server `firstPage`, so client mutations
// (favorite/pin/delete, and a live item-type change) re-bucket it instantly without a server round-trip
// or `router.refresh()`. Falls back to the seeded page before the query resolves. Recent order is
// preserved (the query's flat page order), unlike the pin-sorted `items` the hook also exposes.
export function DashboardRecentItems({ firstPage }: DashboardRecentItemsProps) {
  const { data } = useInfiniteItems({ type: 'recent' }, firstPage)
  const recent = data?.pages.flatMap((page) => page.items) ?? firstPage.items
  const items = recent.slice(0, RECENT_ITEMS_LIMIT)

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => <ItemRow key={item.id} item={item} />)}
    </div>
  )
}
