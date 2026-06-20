import { Suspense } from 'react'
import { DashboardStats } from '@/components/dashboard/dashboard-stats'
import { DashboardCollectionsCard } from '@/components/dashboard/dashboard-collections-card'
import { DashboardPinnedList } from '@/components/dashboard/dashboard-pinned-list'
import { DashboardRecentList } from '@/components/dashboard/dashboard-recent-list'
import {
  StatsCardsSkeleton,
  CollectionsGridSkeleton,
  PinnedSkeleton,
  RecentItemsSkeleton,
} from '@/components/dashboard/dashboard-skeletons'
import type { CollectionWithTypes } from '@/types/collection'
import type { ItemsPage, LightItem } from '@/types/item'
import type { DashboardSkinData } from './shared'

// Classic — the dashboard exactly as it ships today: stat cards + the three collapsible section
// cards. Kept as the free default so existing users see no change. Each section streams in its own
// Suspense boundary, mirroring the original behavior.
export function ClassicSkin({
  statsPromise,
  collectionStatsPromise,
  collectionsPromise,
  pinnedItemsPromise,
  recentItemsPromise,
}: DashboardSkinData) {
  return (
    <>
      <div className="hidden sm:block">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your developer knowledge hub</p>
      </div>

      <Suspense fallback={<StatsCardsSkeleton />}>
        <DashboardStats statsPromise={statsPromise} collectionStatsPromise={collectionStatsPromise} />
      </Suspense>

      <Suspense fallback={<CollectionsGridSkeleton />}>
        <ClassicCollections collectionsPromise={collectionsPromise} />
      </Suspense>

      <Suspense fallback={<PinnedSkeleton />}>
        <ClassicPinned pinnedItemsPromise={pinnedItemsPromise} />
      </Suspense>

      <Suspense fallback={<RecentItemsSkeleton />}>
        <ClassicRecent recentItemsPromise={recentItemsPromise} />
      </Suspense>
    </>
  )
}

interface ClassicCollectionsProps {
  collectionsPromise: Promise<CollectionWithTypes[]>
}

async function ClassicCollections({ collectionsPromise }: ClassicCollectionsProps) {
  const collections = await collectionsPromise
  return <DashboardCollectionsCard collections={collections} />
}

interface ClassicPinnedProps {
  pinnedItemsPromise: Promise<LightItem[]>
}

async function ClassicPinned({ pinnedItemsPromise }: ClassicPinnedProps) {
  const initialItems = await pinnedItemsPromise
  return <DashboardPinnedList initialItems={initialItems} />
}

interface ClassicRecentProps {
  recentItemsPromise: Promise<ItemsPage>
}

async function ClassicRecent({ recentItemsPromise }: ClassicRecentProps) {
  const firstPage = await recentItemsPromise
  if (firstPage.items.length === 0) return null
  return <DashboardRecentList firstPage={firstPage} />
}
