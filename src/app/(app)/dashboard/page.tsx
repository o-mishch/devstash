import { getCurrentUserId } from '@/lib/session'
import { getRecentItemsPage } from '@/lib/db/items'
import { DashboardStats } from './_components/dashboard-stats'
import { DashboardCollections } from './_components/dashboard-collections'
import { DashboardPinned } from './_components/dashboard-pinned'
import { DashboardRecent } from './_components/dashboard-recent'

export default async function DashboardPage() {
  const userId = await getCurrentUserId()

  if (!userId) return null

  const firstPage = await getRecentItemsPage(userId)

  return (
    <div className="flex flex-col gap-4 p-3 sm:gap-6 sm:p-6">
      <div className="hidden sm:block">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your developer knowledge hub</p>
      </div>

      <DashboardStats userId={userId} />
      <DashboardCollections userId={userId} />
      <DashboardPinned userId={userId} />
      <DashboardRecent firstPage={firstPage} />
    </div>
  )
}
