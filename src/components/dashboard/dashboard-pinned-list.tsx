'use client'

import { useMemo } from 'react'
import { Pin } from 'lucide-react'
import { DashboardCollapsibleCard } from '@/components/dashboard/dashboard-collapsible-card'
import { DashboardPinnedItems, mergePinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { usePinnedItemsStore } from '@/stores/pinned-items'
import type { LightItem } from '@/types/item'

interface DashboardPinnedListProps {
  initialItems: LightItem[]
}

export function DashboardPinnedList({ initialItems }: DashboardPinnedListProps) {
  const overrides = usePinnedItemsStore((s) => s.overrides)

  // Hide the whole card (header included) when nothing is pinned, deriving from the same merge the
  // headless list renders from so the two can't disagree.
  const hasItems = useMemo(
    () => mergePinnedItems(initialItems, overrides).length > 0,
    [initialItems, overrides],
  )

  if (!hasItems) return null

  return (
    <DashboardCollapsibleCard icon={Pin} title="Pinned">
      <DashboardPinnedItems initialItems={initialItems} />
    </DashboardCollapsibleCard>
  )
}
