import { Suspense } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getCurrentUserId } from '@/lib/db/collections'
import { DashboardStats } from './_components/dashboard-stats'
import { DashboardCollections } from './_components/dashboard-collections'
import { DashboardPinned } from './_components/dashboard-pinned'
import { DashboardRecent } from './_components/dashboard-recent'

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Skeleton className="size-8 shrink-0 rounded" />
              <div className="space-y-1.5">
                <Skeleton className="h-7 w-10" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function CollectionsSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Collections</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-l-2 border-l-border">
              <CardContent className="p-4 space-y-1.5">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3.5 w-16" />
                <div className="mt-3 flex gap-1.5">
                  <Skeleton className="size-3.5 rounded-sm" />
                  <Skeleton className="size-3.5 rounded-sm" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ItemsListSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border border-border px-2 py-2">
              <Skeleton className="size-5 shrink-0 rounded" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-3.5 w-10 shrink-0" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default async function DashboardPage() {
  const userId = await getCurrentUserId()

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your developer knowledge hub</p>
      </div>

      <Suspense fallback={<StatsSkeleton />}>
        {userId ? <DashboardStats userId={userId} /> : <StatsSkeleton />}
      </Suspense>

      <Suspense fallback={<CollectionsSkeleton />}>
        {userId ? <DashboardCollections userId={userId} /> : <CollectionsSkeleton />}
      </Suspense>

      <Suspense fallback={<ItemsListSkeleton title="Pinned" />}>
        {userId && <DashboardPinned userId={userId} />}
      </Suspense>

      <Suspense fallback={<ItemsListSkeleton title="Recent Items" />}>
        {userId ? <DashboardRecent userId={userId} /> : <ItemsListSkeleton title="Recent Items" />}
      </Suspense>
    </div>
  )
}
