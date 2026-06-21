'use client'

import { useMemo } from 'react'
import { Pin } from 'lucide-react'
import { DashboardWidget } from '@/components/dashboard/dashboard-widget'
import { DashboardPinnedItems, mergePinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { usePinnedItemsStore } from '@/stores/pinned-items'
import { dominantTypeColor } from '@/lib/utils/constants'
import type { LightItem } from '@/types/item'

interface PinnedWidgetProps {
  initialItems: LightItem[]
}

export function PinnedWidget({ initialItems }: PinnedWidgetProps) {
  const overrides = usePinnedItemsStore((s) => s.overrides)

  // Derive both the visibility check and the accent color from the same merge the headless list
  // renders from, so the three can't disagree.
  const merged = useMemo(
    () => mergePinnedItems(initialItems, overrides),
    [initialItems, overrides],
  )

  if (merged.length === 0) return null

  const accentColor = dominantTypeColor(merged.map((item) => item.itemType.name)) ?? undefined

  return (
    <DashboardWidget icon={Pin} title="Pinned" accentColor={accentColor}>
      <DashboardPinnedItems initialItems={initialItems} />
    </DashboardWidget>
  )
}
