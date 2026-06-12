import { Suspense } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Pin } from 'lucide-react'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { DashboardRecentList } from '@/components/dashboard/dashboard-recent-list'
import { ItemRow } from '@/components/dashboard/item-row'
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
  return (
    <Card className="overflow-visible">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-semibold">Collections</CardTitle>
        <Link href="/collections" prefetch={false} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          View all
        </Link>
      </CardHeader>
      <CardContent className="overflow-visible pt-0">
        <CollectionsGrid collections={collections} />
      </CardContent>
    </Card>
  )
}

async function DashboardPinnedSection({
  pinnedItemsPromise,
}: {
  pinnedItemsPromise: Promise<LightItem[]>
}) {
  const pinned = await pinnedItemsPromise
  if (pinned.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
          <Pin className="size-3.5 text-muted-foreground" />
          Pinned
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {pinned.map((item) => <ItemRow key={item.id} item={item} />)}
        </div>
      </CardContent>
    </Card>
  )
}

async function DashboardRecentSection({
  recentItemsPromise,
}: {
  recentItemsPromise: Promise<ItemsPage>
}) {
  const firstPage = await recentItemsPromise
  if (firstPage.items.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Recent Items</CardTitle>
      </CardHeader>
      <CardContent>
        <DashboardRecentList firstPage={firstPage} />
      </CardContent>
    </Card>
  )
}
