'use client'

import { History } from 'lucide-react'
import { DashboardWidget } from '@/components/dashboard/dashboard-widget'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import type { ItemsPage } from '@/types/item'

interface RecentItemsWidgetProps {
  firstPage: ItemsPage
}

export function RecentItemsWidget({ firstPage }: RecentItemsWidgetProps) {
  return (
    <DashboardWidget icon={History} title="Recent Items">
      <DashboardRecentItems firstPage={firstPage} />
    </DashboardWidget>
  )
}
