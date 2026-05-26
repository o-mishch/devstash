import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ItemRow } from '@/components/dashboard/item-row'
import { getRecentItems } from '@/lib/db/items'

interface DashboardRecentProps {
  userId: string
}

export async function DashboardRecent({ userId }: DashboardRecentProps) {
  const recent = await getRecentItems(userId)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Recent Items</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {recent.map((item) => <ItemRow key={item.id} item={item} />)}
        </div>
      </CardContent>
    </Card>
  )
}
