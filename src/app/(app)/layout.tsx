import Link from 'next/link'
import type { WithChildren } from '@/types/common'
import { Archive, Home, Star, Zap } from 'lucide-react'
import { GlobalSearch } from '@/components/shared/global-search'
import { SidebarContent } from '@/components/layout/sidebar-content'
import { MobileDrawer } from '@/components/layout/mobile-drawer'
import { ItemDrawerProvider } from '@/providers/item-drawer-provider'
import { CollectionCreateDialog } from '@/components/dashboard/collection-create-dialog'
import { MobileCreateMenu } from '@/components/layout/mobile-create-menu'
import { TopbarCreateButton } from '@/components/layout/topbar-create-button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cache } from 'react'
import { getSession } from '@/lib/session'
import { fetchSidebarData } from '@/lib/db/sidebar'
import { getProfileData } from '@/lib/db/profile'
import { EditorPreferencesProvider } from '@/providers/editor-preferences-provider'
import { UpgradePromptProvider } from '@/providers/upgrade-prompt-provider'
import { canCreateItem, FREE_TIER_COLLECTION_LIMIT } from '@/lib/usage'

const getSidebarData = cache(async () => {
  const session = await getSession()
  const user = session?.user
    ? { id: session.user.id, name: session.user.name ?? null, email: session.user.email ?? null, image: session.user.image ?? null, isPro: session.user.isPro ?? false }
    : null
  return fetchSidebarData(user)
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
  const session = await getSession()  // deduped by NextAuth's request-level memoization
  const userId = session?.user?.id
  const isPro = session?.user?.isPro ?? false
  // canCreateCollection is derived from already-fetched sidebar data — no extra DB call needed
  const userCanCreateCollection = isPro || sidebarData.collections.length < FREE_TIER_COLLECTION_LIMIT
  const [profileData, userCanCreateItem] = userId
    ? await Promise.all([
        getProfileData(userId).catch(() => null),
        canCreateItem(userId, isPro),
      ])
    : [null, false]
  const initialPreferences = profileData?.user.editorPreferences || null

  return (
    <EditorPreferencesProvider initialPreferences={initialPreferences}>
      <UpgradePromptProvider>
        <ItemDrawerProvider collections={sidebarData.collections} isPro={isPro}>
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
              {!isPro && (
                <Link
                  href="/upgrade"
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <Zap className="size-3" />
                  Upgrade
                </Link>
              )}

              <TooltipProvider delay={400}>
                <Tooltip>
                  <TooltipTrigger render={
                    <Link
                      href="/favorites"
                      aria-label="Favorites"
                      className="card-interactive flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                    >
                      <Star className="size-4" />
                    </Link>
                  } />
                  <TooltipContent>Favorites</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Mobile: single + dropdown for new item / new collection */}
              <MobileCreateMenu itemTypes={sidebarData.itemTypes} collections={sidebarData.collections} canCreateItem={userCanCreateItem} canCreateCollection={userCanCreateCollection} isPro={isPro} />

              {/* Desktop: separate explicit buttons */}
              <div className="hidden lg:flex items-center gap-2">
                <CollectionCreateDialog canCreate={userCanCreateCollection} />
                <TopbarCreateButton itemTypes={sidebarData.itemTypes} collections={sidebarData.collections} canCreateItem={userCanCreateItem} isPro={isPro} />
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
      </UpgradePromptProvider>
      </EditorPreferencesProvider>
  )
}
