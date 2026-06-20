'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

// next/dynamic with ssr:false is only allowed inside a Client Component — so the lazy imports live
// here, not in the server-rendered skin dispatcher. Recharts + react-activity-calendar are loaded
// only when the mission-control skin actually renders, keeping them off every other skin's bundle.

export const MissionControlDonut = dynamic(
  () => import('./charts').then((m) => m.MissionControlDonut),
  { ssr: false, loading: () => <Skeleton className="mx-auto size-[150px] rounded-full" /> },
)

export const MissionControlSparkline = dynamic(
  () => import('./charts').then((m) => m.MissionControlSparkline),
  { ssr: false, loading: () => <Skeleton className="h-[28px] w-full" /> },
)

export const MissionControlHeatmap = dynamic(
  () => import('./charts').then((m) => m.MissionControlHeatmap),
  { ssr: false, loading: () => <Skeleton className="h-[120px] w-full" /> },
)
