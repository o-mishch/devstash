import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import { getCachedSession } from '@/lib/session'
import { getCollectionsPreview, getCollectionStats } from '@/lib/db/collections'
import { getItemStats, getRecentItemsPage, getPinnedItems } from '@/lib/db/items'
import { loadAppSidebarData } from '@/lib/app/sidebar-data'
import { parseLayoutCookie } from '@/lib/utils/layout-cookie'
import { normalizeDashboardSections } from '@/lib/utils/editor-preferences'
import { Button } from '@/components/ui/button'
import { CreateItemDialog } from '@/components/items/item-create-dialog'
import { DashboardStats } from '@/components/dashboard/dashboard-stats'
import { DashboardContent } from '@/components/dashboard/dashboard-content'
import { StatsCardsSkeleton } from '@/components/dashboard/dashboard-skeletons'

export default async function DashboardPage() {
  const session = await getCachedSession()
  const userId = session?.user?.id
  if (!userId) redirect('/sign-in')

  // Kick off all parallel fetches immediately — all backed by 'use cache'
  const statsPromise = getItemStats(userId)
  const collectionsPromise = getCollectionsPreview(userId)
  const recentItemsPromise = getRecentItemsPage(userId)
  const pinnedItemsPromise = getPinnedItems(userId)
  const collectionStatsPromise = getCollectionStats(userId)

  // Persisted collapse state from the ds-layout cookie — resolved server-side so each
  // section card renders its real open/closed state on first paint (no expand→collapse flash).
  const layoutCookie = (await cookies()).get('ds-layout')?.value
  const initialSections = normalizeDashboardSections(parseLayoutCookie(layoutCookie))

  // stats is needed to branch empty state — it's 'use cache' so resolves fast
  const stats = await statsPromise

  if (stats.totalItems === 0) {
    const sidebarData = await loadAppSidebarData(session)
    return (
      <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center sm:p-12 mt-4 bg-muted/20">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Plus className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">Welcome to DevStash!</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mb-6">
            Your dashboard is looking a bit empty. Let&apos;s get started by creating your first item.
          </p>
          <CreateItemDialog
            itemTypes={sidebarData.itemTypes}
            collections={sidebarData.collections}
            trigger={<Button>Create your first item &rarr;</Button>}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
      <div className="hidden sm:block">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your developer knowledge hub</p>
      </div>

      <Suspense fallback={<StatsCardsSkeleton />}>
        <DashboardStats statsPromise={statsPromise} collectionStatsPromise={collectionStatsPromise} />
      </Suspense>

      <DashboardContent
        collectionsPromise={collectionsPromise}
        recentItemsPromise={recentItemsPromise}
        pinnedItemsPromise={pinnedItemsPromise}
        initialSections={initialSections}
      />
    </div>
  )
}
