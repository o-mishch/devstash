import { Suspense } from 'react'
import { DashboardCollectionsCard } from '@/components/dashboard/dashboard-collections-card'
import { DashboardRecentList } from '@/components/dashboard/dashboard-recent-list'
import { DashboardPinnedList } from '@/components/dashboard/dashboard-pinned-list'
import type { ItemsPage, LightItem } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'
import {
  CollectionsGridSkeleton,
  PinnedSkeleton,
  RecentItemsSkeleton,
} from './dashboard-skeletons'

interface DashboardContentProps {
  collectionsPromise: Promise<CollectionWithTypes[]>
  recentItemsPromise: Promise<ItemsPage>
  pinnedItemsPromise: Promise<LightItem[]>
}

export function DashboardContent({
  collectionsPromise,
  recentItemsPromise,
  pinnedItemsPromise,
}: DashboardContentProps) {
  return (
    <>
      <Suspense fallback={<CollectionsGridSkeleton />}>
        <DashboardCollections collectionsPromise={collectionsPromise} />
      </Suspense>

      <Suspense fallback={<PinnedSkeleton />}>
        <DashboardPinnedSection pinnedItemsPromise={pinnedItemsPromise} />
      </Suspense>

      <Suspense fallback={<RecentItemsSkeleton />}>
        <DashboardRecentSection recentItemsPromise={recentItemsPromise} />
      </Suspense>
    </>
  )
}

async function DashboardCollections({
  collectionsPromise,
}: {
  collectionsPromise: Promise<CollectionWithTypes[]>
}) {
  const collections = await collectionsPromise
  return <DashboardCollectionsCard collections={collections} />
}

async function DashboardPinnedSection({
  pinnedItemsPromise,
}: {
  pinnedItemsPromise: Promise<LightItem[]>
}) {
  const initialItems = await pinnedItemsPromise
  return <DashboardPinnedList initialItems={initialItems} />
}

async function DashboardRecentSection({
  recentItemsPromise,
}: {
  recentItemsPromise: Promise<ItemsPage>
}) {
  const firstPage = await recentItemsPromise
  if (firstPage.items.length === 0) return null

  return <DashboardRecentList firstPage={firstPage} />
}
