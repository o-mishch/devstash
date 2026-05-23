import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { getAllCollections, getCurrentUserId } from '@/lib/db/collections'
import { getSidebarItemTypes } from '@/lib/db/items'

interface DashboardRootLayoutProps {
  children: React.ReactNode
}

export default async function DashboardRootLayout({ children }: DashboardRootLayoutProps) {
  const userId = await getCurrentUserId()
  const [collections, itemTypes] = userId
    ? await Promise.all([getAllCollections(userId), getSidebarItemTypes(userId)])
    : [[], []]

  return (
    <DashboardLayout sidebarData={{ collections, itemTypes }}>
      {children}
    </DashboardLayout>
  )
}
