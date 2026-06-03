import Link from 'next/link'
import type { WithChildren } from '@/types/common'
import { APP_THEMES } from '@/types/editor-preferences'
import { Archive, Home } from 'lucide-react'
import { GlobalSearch } from '@/components/shared/global-search'
import { SidebarContent } from '@/components/layout/sidebar-content'
import { MobileDrawer } from '@/components/layout/mobile-drawer'
import { TopbarFavoritesLink } from '@/components/layout/topbar-favorites-link'
import { ItemDrawerProvider } from '@/components/items/item-drawer-provider'
import { CollectionCreateDialog } from '@/components/dashboard/collection-create-dialog'
import { MobileCreateMenu } from '@/components/layout/mobile-create-menu'
import { TopbarCreateButton } from '@/components/layout/topbar-create-button'
import { cache } from 'react'
import { getSession } from '@/lib/session'
import { fetchSidebarData } from '@/lib/db/sidebar'
import { getProfileData } from '@/lib/db/profile'
import { EditorPreferencesProvider } from '@/components/providers/editor-preferences-provider'
import { ThemeProvider } from 'next-themes'

const getSidebarData = cache(async () => {
  const session = await getSession()
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
  const session = await getSession()  // deduped via cache()
  const userId = session?.user?.id
  const profileData = userId ? await getProfileData(userId).catch(() => null) : null
  const initialPreferences = profileData?.user.editorPreferences || null
  const rawTheme = initialPreferences?.appTheme
  const appTheme = rawTheme && APP_THEMES.includes(rawTheme) && rawTheme !== 'vscode' ? rawTheme : null

  return (
    <ThemeProvider attribute="data-theme" defaultTheme={appTheme || 'vscode'} enableSystem={false}>
      <EditorPreferencesProvider initialPreferences={initialPreferences}>
        <ItemDrawerProvider collections={sidebarData.collections}>
        <div className="flex h-screen flex-col bg-background">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
            <MobileDrawerAsync />

            {/* Mobile: compact Home icon */}
            <Link
              href="/dashboard"
              className="flex shrink-0 items-center justify-center size-9 rounded-lg hover:bg-foreground/5 transition-colors lg:hidden"
              aria-label="Home"
            >
              <Home className="size-5 text-primary" />
            </Link>

            {/* Desktop: full logo + app name */}
            <Link href="/dashboard" className="hidden shrink-0 items-center gap-2 hover:opacity-80 transition-opacity lg:flex">
              <Archive className="size-4 text-primary" />
              <span className="text-base font-semibold tracking-tight">DevStash</span>
            </Link>

            <GlobalSearch collections={sidebarData.collections} />

            <div className="flex shrink-0 items-center gap-2">
              <TopbarFavoritesLink />

              {/* Mobile: single + dropdown for new item / new collection */}
              <MobileCreateMenu itemTypes={sidebarData.itemTypes} collections={sidebarData.collections} />

              {/* Desktop: separate explicit buttons */}
              <div className="hidden lg:flex items-center gap-2">
                <CollectionCreateDialog />
                <TopbarCreateButton itemTypes={sidebarData.itemTypes} collections={sidebarData.collections} />
              </div>
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
    </ThemeProvider>
  )
}
