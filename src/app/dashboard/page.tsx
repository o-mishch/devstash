import { Pin } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { ItemRow } from '@/components/dashboard/item-row'
import { getAllCollections, getCurrentUserId } from '@/lib/db/collections'
import { getPinnedItems, getRecentItems, getItemStats, getSidebarItemTypes } from '@/lib/db/items'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function DashboardPage() {
  const userId = await getCurrentUserId()

  const [allCollections, pinned, recent, itemStats, itemTypes] = userId
    ? await Promise.all([
        getAllCollections(userId),
        getPinnedItems(userId),
        getRecentItems(userId),
        getItemStats(userId),
        getSidebarItemTypes(userId),
      ])
    : [[], [], [], { totalItems: 0, favoriteItems: 0 }, []]

  const collectionStats = {
    totalCollections: allCollections.length,
    favoriteCollections: allCollections.filter((c) => c.isFavorite).length,
  }
  const collections = allCollections.slice(0, 6)
  const sidebarData = { collections: allCollections, itemTypes }

  return (
    <DashboardLayout sidebarData={sidebarData}>
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your developer knowledge hub</p>
        </div>

        <StatsCards
          totalItems={itemStats.totalItems}
          totalCollections={collectionStats.totalCollections}
          favoriteItems={itemStats.favoriteItems}
          favoriteCollections={collectionStats.favoriteCollections}
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
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <Pin className="size-3.5" />
                Pinned
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                {pinned.map((item) => <ItemRow key={item.id} item={item} />)}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Recent Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {recent.map((item) => <ItemRow key={item.id} item={item} />)}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
