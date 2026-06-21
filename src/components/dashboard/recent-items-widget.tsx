'use client'

import { History } from 'lucide-react'
import { DashboardWidget } from '@/components/dashboard/dashboard-widget'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { dominantTypeColor } from '@/lib/utils/constants'
import type { ItemsPage } from '@/types/item'

interface RecentItemsWidgetProps {
  firstPage: ItemsPage
}

export function RecentItemsWidget({ firstPage }: RecentItemsWidgetProps) {
  const accentColor = dominantTypeColor(firstPage.items.map((item) => item.itemType.name)) ?? undefined

  return (
    <DashboardWidget icon={History} title="Recent Items" accentColor={accentColor}>
      <DashboardRecentItems firstPage={firstPage} />
    </DashboardWidget>
  )
}
