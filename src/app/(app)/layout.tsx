import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { Archive, Home, Search, Star, Zap } from 'lucide-react'
import type { WithChildren } from '@/types/common'

import { getCachedSession } from '@/lib/session'
import { loadAppSidebarData } from '@/lib/app/sidebar-data'
import { getEditorPreferences } from '@/lib/db/profile'
import { canCreateCollection, canCreateItem } from '@/lib/db/usage'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'

import { SidebarSkeleton } from '@/components/layout/sidebar/sidebar-skeleton'
import { DynamicPageSkeleton } from '@/components/dashboard/dynamic-page-skeleton'
import { AppUserFlagsInitializer } from '@/components/shared/app-user-flags-initializer'
import { EditorPreferencesInitializer } from '@/components/shared/editor-preferences-initializer'
import { GlobalSearch } from '@/components/shared/global-search'
import { MobileDrawer } from '@/components/layout/mobile-drawer'
import { MobileCreateMenu } from '@/components/layout/mobile-create-menu'
import { TopbarCreateButton } from '@/components/layout/topbar-create-button'
import { SidebarContent } from '@/components/layout/sidebar-content'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CollectionCreateDialog } from '@/components/dashboard/collection-create-dialog'
import { UpgradePromptProvider } from '@/providers/upgrade-prompt-provider'
import { ItemDrawerProvider } from '@/providers/item-drawer-provider'
import { EditorPreloader } from '@/components/shared/dynamic-editors'
import { RootProviderShell } from '@/components/shared/root-provider-shell'
import { ThemeInitializer } from '@/components/shared/theme-initializer'
import { normalizeEditorPreferences } from '@/lib/utils/editor-preferences'

export default async function DashboardLayout({ children }: WithChildren) {
  const { appTheme, colorMode } = normalizeEditorPreferences(null)

  return (
    <RootProviderShell theme={appTheme} colorMode={colorMode} themeScript>
      <ThemeInitializer />
      <ItemDrawerProvider>
        <EditorPreloader />
        <Suspense fallback={<DashboardLayoutSkeleton />}>
          <DashboardLayoutInner>
            {children}
          </DashboardLayoutInner>
        </Suspense>
      </ItemDrawerProvider>
    </RootProviderShell>
  )
}

function DashboardLayoutSkeleton() {
  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      <header className="app-topbar relative z-20 flex h-14 min-w-0 shrink-0 items-center gap-3 border-b border-border px-4">
        {/* Mobile menu trigger skeleton */}
        <div className="size-11 shrink-0 lg:hidden" />

        {/* Mobile: compact Home icon placeholder */}
        <div className="flex shrink-0 items-center justify-center size-9 rounded-lg lg:hidden">
          <Home className="size-5 text-muted-foreground/30 animate-pulse" />
        </div>

        {/* Desktop: full logo + app name */}
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <Archive className="size-4 text-muted-foreground/50" />
          <span className="text-base font-semibold tracking-tight text-muted-foreground/50">DevStash</span>
        </div>

        {/* Search bar skeleton — mirrors GlobalSearch: leading Search icon + single-line placeholder */}
        <div className="relative mx-auto min-w-0 flex-1 max-w-sm opacity-50">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <div className="flex h-9 w-full select-none items-center overflow-hidden whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-1 pl-8 text-sm text-muted-foreground shadow-sm touch:h-11">
            Search items...
          </div>
        </div>

        {/* Right actions: Favorites + mobile create + desktop buttons — match real header */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="card-interactive size-11 rounded-md bg-foreground/5 animate-pulse" />
          {/* Mobile create button */}
          <div className="size-11 rounded-md bg-foreground/5 animate-pulse lg:hidden" />
          {/* Desktop buttons */}
          <div className="hidden lg:flex items-center gap-2">
            <div className="h-9 w-28 rounded-md bg-foreground/5 animate-pulse" />
            <div className="h-9 w-24 rounded-md bg-foreground/5 animate-pulse" />
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <SidebarSkeleton collapsible />
        <main className="app-dot-grid relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-background [scrollbar-gutter:stable]">
          {/* Ambient glow blobs — z-0 so they never cover page content */}
          <div aria-hidden className="pointer-events-none absolute left-1/3 top-0 z-0 h-[500px] w-[600px] -translate-x-1/2 rounded-full bg-blue-500/[0.08] blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute right-0 top-1/3 z-0 h-[400px] w-[500px] rounded-full bg-cyan-500/[0.06] blur-3xl" />
          <div className="relative z-10 flex min-w-0 flex-1 flex-col">
            <DynamicPageSkeleton />
          </div>
        </main>
      </div>
    </div>
  )
}

async function DashboardLayoutInner({ children }: WithChildren) {
  const session = await getCachedSession()
  const userId = session?.user?.id
  if (!userId) redirect('/sign-in')

  const preferences = await getEditorPreferences(userId).catch(() => null)
  const initialPreferences = normalizeEditorPreferences(preferences)

  // Resolve isPro first from the Redis Pro cache (~1ms on hit) so the usage
  // checks can run in parallel with the billing sync inside loadAppSidebarData.
  // getCachedVerifiedProAccess is deduplicated by cache(), so loadAppSidebarData
  // reuses the result — no double fetch.
  const isPro = await getCachedVerifiedProAccess(userId)

  // All three fetches in one parallel round-trip
  const [sidebarData, userCanCreateItem, userCanCreateCollection] = await Promise.all([
    loadAppSidebarData(session),
    canCreateItem(userId, isPro),
    canCreateCollection(userId, isPro),
  ])

  return (
    <>
      <AppUserFlagsInitializer
        isPro={isPro}
        canCreateItem={userCanCreateItem}
        canCreateCollection={userCanCreateCollection}
      />
      <EditorPreferencesInitializer preferences={initialPreferences} />
      <UpgradePromptProvider>
          <div className="relative flex h-screen flex-col overflow-hidden bg-background">
            <header className="app-topbar relative z-20 flex h-14 min-w-0 shrink-0 items-center gap-3 border-b border-border px-4">
              <MobileDrawer sidebarData={sidebarData} />

              {/* Mobile: compact Home icon */}
              <Link
                href="/dashboard"
                prefetch={false}
                className="flex shrink-0 items-center justify-center size-9 touch:size-11 rounded-lg hover:bg-foreground/5 transition-colors lg:hidden"
                aria-label="Home"
              >
                <Home className="size-5 text-primary" />
              </Link>

              {/* Desktop: full logo + app name */}
              <Link href="/dashboard" prefetch={false} className="hidden shrink-0 items-center gap-2 hover:opacity-80 transition-opacity lg:flex">
                <Archive className="size-4 text-primary" />
                <span className="text-base font-semibold tracking-tight">DevStash</span>
              </Link>

              <GlobalSearch collections={sidebarData.collections} />

              <div className="flex shrink-0 items-center gap-2">
                {!isPro && (
                  <Link
                    href="/upgrade"
                    prefetch={false}
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
                        prefetch={false}
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
                <MobileCreateMenu itemTypes={sidebarData.itemTypes} collections={sidebarData.collections} />

                {/* Desktop: separate explicit buttons */}
                <div className="hidden lg:flex items-center gap-2">
                  <CollectionCreateDialog />
                  <TopbarCreateButton itemTypes={sidebarData.itemTypes} collections={sidebarData.collections} />
                </div>
              </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
              <SidebarContent sidebarData={sidebarData} collapsible />

              <main className="app-dot-grid relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-background [scrollbar-gutter:stable]">
                {/* Ambient glow blobs — z-0 so they never cover page content */}
                <div aria-hidden className="pointer-events-none absolute left-1/3 top-0 z-0 h-[500px] w-[600px] -translate-x-1/2 rounded-full bg-blue-500/[0.08] blur-3xl" />
                <div aria-hidden className="pointer-events-none absolute right-0 top-1/3 z-0 h-[400px] w-[500px] rounded-full bg-cyan-500/[0.06] blur-3xl" />
                <div className="relative z-10 flex min-w-0 flex-1 flex-col">{children}</div>
              </main>
            </div>
          </div>
      </UpgradePromptProvider>
    </>
  )
}
