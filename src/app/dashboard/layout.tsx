import { auth } from '@/auth'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { getAllCollections } from '@/lib/db/collections'
import { getSidebarItemTypes } from '@/lib/db/items'
import type { SidebarUser } from '@/components/layout/dashboard-layout'

interface DashboardRootLayoutProps {
  children: React.ReactNode
}

export default async function DashboardRootLayout({ children }: DashboardRootLayoutProps) {
  const session = await auth()
  const userId: string | null = session?.user?.id ?? null

  const [collections, itemTypes] = await Promise.all([
    userId ? getAllCollections(userId) : Promise.resolve([]),
    getSidebarItemTypes(userId),
  ])

  const user: SidebarUser | null = session?.user
    ? {
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }
    : null

  return (
    <DashboardLayout sidebarData={{ collections, itemTypes, user }}>
      {children}
    </DashboardLayout>
  )
}
