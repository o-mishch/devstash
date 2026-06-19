import { Suspense } from 'react'
import { DashboardCollectionsCard } from '@/components/dashboard/dashboard-collections-card'
import { DashboardRecentList } from '@/components/dashboard/dashboard-recent-list'
import { DashboardPinnedList } from '@/components/dashboard/dashboard-pinned-list'
import type { ItemsPage, LightItem } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'
import type { DashboardSections } from '@/types/editor-preferences'
import {
  CollectionsGridSkeleton,
  PinnedSkeleton,
  RecentItemsSkeleton,
} from './dashboard-skeletons'

interface DashboardContentProps {
  collectionsPromise: Promise<CollectionWithTypes[]>
  recentItemsPromise: Promise<ItemsPage>
  pinnedItemsPromise: Promise<LightItem[]>
  // Persisted collapse state resolved server-side from the ds-layout cookie, so each
  // section's card renders its real open/closed state on first paint (no flash).
  initialSections: DashboardSections
}

export function DashboardContent({
  collectionsPromise,
  recentItemsPromise,
  pinnedItemsPromise,
  initialSections,
}: DashboardContentProps) {
  return (
    <>
      <Suspense fallback={<CollectionsGridSkeleton />}>
        <DashboardCollections collectionsPromise={collectionsPromise} defaultOpen={initialSections.collections} />
      </Suspense>

      <Suspense fallback={<PinnedSkeleton />}>
        <DashboardPinnedSection pinnedItemsPromise={pinnedItemsPromise} defaultOpen={initialSections.pinned} />
      </Suspense>

      <Suspense fallback={<RecentItemsSkeleton />}>
        <DashboardRecentSection recentItemsPromise={recentItemsPromise} defaultOpen={initialSections.recent} />
      </Suspense>
    </>
  )
}

async function DashboardCollections({
  collectionsPromise,
  defaultOpen,
}: {
  collectionsPromise: Promise<CollectionWithTypes[]>
  defaultOpen: boolean
}) {
  const collections = await collectionsPromise
  return <DashboardCollectionsCard collections={collections} defaultOpen={defaultOpen} />
}

async function DashboardPinnedSection({
  pinnedItemsPromise,
  defaultOpen,
}: {
  pinnedItemsPromise: Promise<LightItem[]>
  defaultOpen: boolean
}) {
  const initialItems = await pinnedItemsPromise
  return <DashboardPinnedList initialItems={initialItems} defaultOpen={defaultOpen} />
}

async function DashboardRecentSection({
  recentItemsPromise,
  defaultOpen,
}: {
  recentItemsPromise: Promise<ItemsPage>
  defaultOpen: boolean
}) {
  const firstPage = await recentItemsPromise
  if (firstPage.items.length === 0) return null

  return <DashboardRecentList firstPage={firstPage} defaultOpen={defaultOpen} />
}
