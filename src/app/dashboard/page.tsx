import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { ItemList } from '@/components/dashboard/item-list'
import { mockItems as items } from '@/lib/mock-data'
import { getRecentCollections, getCurrentUserId } from '@/lib/db/collections'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const RECENT_ITEMS_LIMIT = 10

function getPinnedItems() {
  return items.filter((item) => item.isPinned)
}

function getRecentItems() {
  return [...items]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, RECENT_ITEMS_LIMIT)
}

export default async function DashboardPage() {
  const userId = await getCurrentUserId()
  const collections = userId ? await getRecentCollections(userId) : []

  const pinned = getPinnedItems()
  const recent = getRecentItems()

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your developer knowledge hub</p>
        </div>

        <StatsCards
          totalItems={items.length}
          totalCollections={collections.length}
          favoriteItems={items.filter((i) => i.isFavorite).length}
          favoriteCollections={collections.filter((c) => c.isFavorite).length}
        />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-semibold">Collections</CardTitle>
            <a href="/collections" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              View all
            </a>
          </CardHeader>
          <CardContent>
            <CollectionsGrid collections={collections} />
          </CardContent>
        </Card>

        {pinned.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Pinned</CardTitle>
            </CardHeader>
            <CardContent>
              <ItemList items={pinned} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Recent Items</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemList items={recent} />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
