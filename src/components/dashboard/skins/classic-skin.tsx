import { Suspense } from 'react'
import { DashboardStats } from '@/components/dashboard/dashboard-stats'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { CollectionsWidget } from '@/components/dashboard/collections-widget'
import { PinnedWidget } from '@/components/dashboard/pinned-widget'
import { RecentItemsWidget } from '@/components/dashboard/recent-items-widget'
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
  isPro,
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

      <Suspense fallback={<StatsCardsSkeleton isPro={isPro} />}>
        <DashboardStats statsPromise={statsPromise} collectionStatsPromise={collectionStatsPromise} isPro={isPro} />
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

      {/* AI Usage — demoted to the foot of the dashboard: occasional-reassurance data, below content. */}
      {isPro && <AiUsageWidget skin="classic" />}
    </>
  )
}

interface ClassicCollectionsProps {
  collectionsPromise: Promise<CollectionWithTypes[]>
}

async function ClassicCollections({ collectionsPromise }: ClassicCollectionsProps) {
  const collections = await collectionsPromise
  return <CollectionsWidget collections={collections} />
}

interface ClassicPinnedProps {
  pinnedItemsPromise: Promise<LightItem[]>
}

async function ClassicPinned({ pinnedItemsPromise }: ClassicPinnedProps) {
  const initialItems = await pinnedItemsPromise
  return <PinnedWidget initialItems={initialItems} />
}

interface ClassicRecentProps {
  recentItemsPromise: Promise<ItemsPage>
}

async function ClassicRecent({ recentItemsPromise }: ClassicRecentProps) {
  const firstPage = await recentItemsPromise
  if (firstPage.items.length === 0) return null
  return <RecentItemsWidget firstPage={firstPage} />
}
