'use client'

import { History } from 'lucide-react'
import { DashboardCollapsibleCard } from '@/components/dashboard/dashboard-collapsible-card'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import type { ItemsPage } from '@/types/item'

interface DashboardRecentListProps {
  firstPage: ItemsPage
}

export function DashboardRecentList({ firstPage }: DashboardRecentListProps) {
  return (
    <DashboardCollapsibleCard icon={History} title="Recent Items">
      <DashboardRecentItems firstPage={firstPage} />
    </DashboardCollapsibleCard>
  )
}
