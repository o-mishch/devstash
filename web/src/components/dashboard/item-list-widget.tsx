import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { LightItem } from '@/client'
import { DashboardWidget } from '@/components/dashboard/dashboard-widget'
import { ItemRow } from '@/components/dashboard/item-row'
import { dominantTypeColor } from '@/lib/type-colors'

interface ItemListWidgetProps {
  icon: LucideIcon
  title: string
  items: LightItem[]
}

/**
 * Shared dashboard item-list section (used for "Pinned" and "Recent Items"): renders nothing when
 * empty, otherwise a `DashboardWidget` accented by the dominant item-type color wrapping a
 * flex-col of `ItemRow`s.
 */
export function ItemListWidget({ icon, title, items }: ItemListWidgetProps): ReactNode {
  if (items.length === 0) return null
  const accentColor = dominantTypeColor(items.map((item) => item.itemType.name)) ?? undefined

  return (
    <DashboardWidget icon={icon} title={title} accentColor={accentColor}>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </div>
    </DashboardWidget>
  )
}
