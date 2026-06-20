import { ItemRow } from '@/components/dashboard/item-row'
import type { ItemsPage } from '@/types/item'

// Cap on recent items shown on the dashboard across all skins — a short, fixed list (no infinite
// scroll, no virtualization). Browse the full list from the items pages.
const RECENT_ITEMS_LIMIT = 7

interface DashboardRecentItemsProps {
  firstPage: ItemsPage
}

// Headless recent list (no card chrome) — a simple, capped list of the most recent items. Consumed
// by the classic collapsible card and by the dashboard skins, which wrap it in their own panel.
export function DashboardRecentItems({ firstPage }: DashboardRecentItemsProps) {
  const items = firstPage.items.slice(0, RECENT_ITEMS_LIMIT)

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => <ItemRow key={item.id} item={item} />)}
    </div>
  )
}
