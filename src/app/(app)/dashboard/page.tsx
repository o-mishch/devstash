import { getCurrentUserId } from '@/lib/session'
import { getRecentItemsPage, getItemStats } from '@/lib/db/items'
import { DashboardStats } from './_components/dashboard-stats'
import { DashboardCollections } from './_components/dashboard-collections'
import { DashboardPinned } from './_components/dashboard-pinned'
import { DashboardRecentList } from './_components/dashboard-recent-list'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import Link from 'next/link'

export default async function DashboardPage() {
  const userId = await getCurrentUserId()

  if (!userId) return null

  const [firstPage, itemStats] = await Promise.all([
    getRecentItemsPage(userId),
    getItemStats(userId),
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
          <Link href="/items/snippets">
            <Button>Create your first item &rarr;</Button>
          </Link>
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
