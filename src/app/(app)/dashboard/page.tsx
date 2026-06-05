import { getCurrentUserId } from '@/lib/session'
import { getRecentItemsPage, getItemStats } from '@/lib/db/items'
import { DashboardStats } from './_components/dashboard-stats'
import { DashboardCollections } from './_components/dashboard-collections'
import { DashboardPinned } from './_components/dashboard-pinned'
import { DashboardRecentList } from './_components/dashboard-recent-list'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { getSession } from '@/lib/session'
import { fetchSidebarData } from '@/lib/db/sidebar'
import { canCreateItem } from '@/lib/usage'
import { CreateItemDialog } from '@/components/items/item-create-dialog'

export default async function DashboardPage() {
  const session = await getSession()
  const userId = session?.user?.id
  const user = session?.user
    ? { id: session.user.id, name: session.user.name ?? null, email: session.user.email ?? null, image: session.user.image ?? null, isPro: session.user.isPro ?? false }
    : null

  if (!userId || !user) return null

  const [firstPage, itemStats, sidebarData, userCanCreateItem] = await Promise.all([
    getRecentItemsPage(userId),
    getItemStats(userId),
    fetchSidebarData(user),
    canCreateItem(userId, user.isPro),
  ])

  const isEmpty = itemStats.totalItems === 0

  return (
    <div className="flex flex-col gap-4 p-3 sm:gap-6 sm:p-6">
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
            canCreate={userCanCreateItem}
            isPro={user.isPro}
            trigger={<Button>Create your first item &rarr;</Button>}
          />
        </div>
      ) : (
        <>
          <DashboardCollections userId={userId} />
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
