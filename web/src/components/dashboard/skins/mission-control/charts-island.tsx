import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import type { ActivityDay, ItemTypeCount } from '@/client'
import { Skeleton } from '@/components/ui/skeleton'

// React.lazy code-splits Recharts + react-activity-calendar into their own chunk, loaded only when
// the Mission Control skin renders — so the heavy charting deps never ship on the classic/default
// dashboard path (the SPA-mode equivalent of the legacy `next/dynamic({ ssr: false })` island).

const LazyDonut = lazy(async () => {
  const m = await import('./charts')
  return { default: m.MissionControlDonut }
})
const LazySparkline = lazy(async () => {
  const m = await import('./charts')
  return { default: m.MissionControlSparkline }
})
const LazyHeatmap = lazy(async () => {
  const m = await import('./charts')
  return { default: m.MissionControlHeatmap }
})

interface DonutProps {
  distribution: ItemTypeCount[]
}

interface ActivityChartProps {
  activity: ActivityDay[]
}

export function MissionControlDonut({ distribution }: DonutProps): ReactNode {
  return (
    <Suspense fallback={<Skeleton className="mx-auto size-[150px] rounded-full" />}>
      <LazyDonut distribution={distribution} />
    </Suspense>
  )
}

export function MissionControlSparkline({ activity }: ActivityChartProps): ReactNode {
  return (
    <Suspense fallback={<Skeleton className="mt-2 h-[28px] w-full" />}>
      <LazySparkline activity={activity} />
    </Suspense>
  )
}

export function MissionControlHeatmap({ activity }: ActivityChartProps): ReactNode {
  return (
    <Suspense fallback={<Skeleton className="h-[120px] w-full" />}>
      <LazyHeatmap activity={activity} />
    </Suspense>
  )
}
