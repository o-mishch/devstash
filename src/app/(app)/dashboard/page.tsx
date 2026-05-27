import { getCurrentUserId } from '@/lib/session'
import { DashboardStats } from './_components/dashboard-stats'
import { DashboardCollections } from './_components/dashboard-collections'
import { DashboardPinned } from './_components/dashboard-pinned'
import { DashboardRecent } from './_components/dashboard-recent'

export default async function DashboardPage() {
  const userId = await getCurrentUserId()

  if (!userId) return null

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your developer knowledge hub</p>
      </div>

      <DashboardStats userId={userId} />
      <DashboardCollections userId={userId} />
      <DashboardPinned userId={userId} />
      <DashboardRecent userId={userId} />
    </div>
  )
}
