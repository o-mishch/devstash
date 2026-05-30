import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DashboardRecentList } from './dashboard-recent-list'
import type { ItemsPage } from '@/types/item'

interface DashboardRecentProps {
  firstPage: ItemsPage
}

export function DashboardRecent({ firstPage }: DashboardRecentProps) {
  if (firstPage.items.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Recent Items</CardTitle>
      </CardHeader>
      <CardContent>
        <DashboardRecentList firstPage={firstPage} />
      </CardContent>
    </Card>
  )
}
