import { getCollectionsPreview } from '@/lib/db/collections'
import { getItemStats, getRecentItemsPage } from '@/lib/db/items'
import { DashboardStats } from '@/components/dashboard/dashboard-stats'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DashboardPinned } from '@/components/dashboard/dashboard-pinned'
import { DashboardRecentList } from '@/components/dashboard/dashboard-recent-list'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { loadAppSidebarData } from '@/lib/app/sidebar-data'
import { getCachedSession } from '@/lib/session'
import { CreateItemDialog } from '@/components/items/item-create-dialog'

export default async function DashboardPage() {
  const session = await getCachedSession()
  const userId = session?.user?.id
  if (!userId) redirect('/sign-in')

  const sidebarData = await loadAppSidebarData(session)

  const [firstPage, itemStats, collections] = await Promise.all([
    getRecentItemsPage(userId),
    getItemStats(userId),
    getCollectionsPreview(userId),
  ])
  const isEmpty = itemStats.totalItems === 0

  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
      <div className="hidden sm:block">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your developer knowledge hub</p>
      </div>

      <DashboardStats userId={userId} />

      {isEmpty ? (
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
      ) : (
        <>
          <Card className="overflow-visible">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold">Collections</CardTitle>
              <Link href="/collections" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                View all
              </Link>
            </CardHeader>
            <CardContent className="overflow-visible pt-0">
              <CollectionsGrid collections={collections} />
            </CardContent>
          </Card>
          <DashboardPinned userId={userId} />
          {firstPage.items.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Recent Items</CardTitle>
              </CardHeader>
              <CardContent>
                <DashboardRecentList firstPage={firstPage} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
