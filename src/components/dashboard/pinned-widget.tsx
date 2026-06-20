'use client'

import { useMemo } from 'react'
import { Pin } from 'lucide-react'
import { DashboardWidget } from '@/components/dashboard/dashboard-widget'
import { DashboardPinnedItems, mergePinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { usePinnedItemsStore } from '@/stores/pinned-items'
import type { LightItem } from '@/types/item'

interface PinnedWidgetProps {
  initialItems: LightItem[]
}

export function PinnedWidget({ initialItems }: PinnedWidgetProps) {
  const overrides = usePinnedItemsStore((s) => s.overrides)

  // Hide the whole widget (header included) when nothing is pinned, deriving from the same merge the
  // headless list renders from so the two can't disagree.
  const hasItems = useMemo(
    () => mergePinnedItems(initialItems, overrides).length > 0,
    [initialItems, overrides],
  )

  if (!hasItems) return null

  return (
    <DashboardWidget icon={Pin} title="Pinned">
      <DashboardPinnedItems initialItems={initialItems} />
    </DashboardWidget>
  )
}
