'use client'

import { useMemo } from 'react'
import { Pin } from 'lucide-react'
import { ItemRow } from '@/components/dashboard/item-row'
import { DashboardCollapsibleCard } from '@/components/dashboard/dashboard-collapsible-card'
import { usePinnedItemsStore } from '@/stores/pinned-items'
import type { LightItem } from '@/types/item'

interface DashboardPinnedListProps {
  initialItems: LightItem[]
  defaultOpen: boolean
}

export function DashboardPinnedList({ initialItems, defaultOpen }: DashboardPinnedListProps) {
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
    <DashboardCollapsibleCard icon={Pin} title="Pinned" section="pinned" defaultOpen={defaultOpen}>
      <div className="flex flex-col gap-[12px]">
        {items.map((item) => <ItemRow key={item.id} item={item} />)}
      </div>
    </DashboardCollapsibleCard>
  )
}
