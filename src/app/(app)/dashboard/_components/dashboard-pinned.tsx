import { Pin } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ItemRow } from '@/components/dashboard/item-row'
import { getPinnedItems } from '@/lib/db/items'
import { itemToLightItem } from '@/types/item'

interface DashboardPinnedProps {
  userId: string
}

export async function DashboardPinned({ userId }: DashboardPinnedProps) {
  const pinned = await getPinnedItems(userId)
  if (pinned.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
          <Pin className="size-3.5" />
          Pinned
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {pinned.map((item) => <ItemRow key={item.id} item={itemToLightItem(item)} />)}
        </div>
      </CardContent>
    </Card>
  )
}
