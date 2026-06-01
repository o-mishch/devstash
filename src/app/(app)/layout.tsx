import Link from 'next/link'
import type { WithChildren } from '@/types/common'
import { Archive, Star } from 'lucide-react'
import { GlobalSearch } from '@/components/shared/global-search'
import { SidebarContent } from '@/components/layout/sidebar-content'
import { MobileDrawer } from '@/components/layout/mobile-drawer'
import { ItemDrawerProvider } from '@/components/items/item-drawer-provider'
import { CreateItemDialog } from '@/components/items/item-create-dialog'
import { CollectionCreateDialog } from '@/components/dashboard/collection-create-dialog'
import { cache } from 'react'
import { auth } from '@/auth'
import { fetchSidebarData } from '@/lib/db/sidebar'
import { getProfileData } from '@/lib/db/profile'
import { EditorPreferencesProvider } from '@/components/providers/editor-preferences-provider'
const getSidebarData = cache(async () => {
  const session = await auth()
  const userId = session?.user?.id ?? null
  const user = session?.user
    ? { name: session.user.name ?? null, email: session.user.email ?? null, image: session.user.image ?? null }
    : null
  return fetchSidebarData(userId, user)
})

async function SidebarAsync() {
  const sidebarData = await getSidebarData()
  return <SidebarContent sidebarData={sidebarData} collapsible />
}

async function MobileDrawerAsync() {
  const sidebarData = await getSidebarData()
  return <MobileDrawer sidebarData={sidebarData} />
}

export default async function DashboardLayout({ children }: WithChildren) {
  const sidebarData = await getSidebarData()
  const session = await auth()
  const userId = session?.user?.id
  const profileData = userId ? await getProfileData(userId) : null
  const initialPreferences = profileData?.user.editorPreferences || null

  return (
    <EditorPreferencesProvider initialPreferences={initialPreferences}>
      <ItemDrawerProvider collections={sidebarData.collections}>
      <div className="flex h-screen flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <MobileDrawerAsync />

          <Link href="/dashboard" className="flex shrink-0 items-center gap-2 hover:opacity-80 transition-opacity">
            <Archive className="size-4 text-primary" />
            <span className="text-base font-semibold tracking-tight">DevStash</span>
          </Link>

          <GlobalSearch collections={sidebarData.collections} />

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/favorites"
              id="topbar-favorites-link"
              aria-label="Favorites"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Star className="size-4" />
            </Link>
            <CollectionCreateDialog />
            <CreateItemDialog itemTypes={sidebarData.itemTypes} collections={sidebarData.collections} />
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <SidebarAsync />

          <main className="flex flex-1 flex-col overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </ItemDrawerProvider>
    </EditorPreferencesProvider>
  )
}
