'use client'

import { useMemo } from 'react'
import { Pin } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ItemRow } from '@/components/dashboard/item-row'
import { usePinnedItemsStore } from '@/stores/pinned-items'
import type { LightItem } from '@/types/item'

interface DashboardPinnedListProps {
  initialItems: LightItem[]
}

export function DashboardPinnedList({ initialItems }: DashboardPinnedListProps) {
  const overrides = usePinnedItemsStore((s) => s.overrides)

  const items = useMemo(() => {
    const result = new Map<string, LightItem>(initialItems.map((i) => [i.id, i]))
    for (const [id, { item, pinned }] of overrides) {
      if (pinned) {
        result.set(id, { ...item, isPinned: true })
      } else {
        result.delete(id)
      }
    }
    return [...result.values()]
  }, [initialItems, overrides])

  if (items.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
          <Pin className="size-3.5 text-muted-foreground" />
          Pinned
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-[12px]">
          {items.map((item) => <ItemRow key={item.id} item={item} />)}
        </div>
      </CardContent>
    </Card>
  )
}
