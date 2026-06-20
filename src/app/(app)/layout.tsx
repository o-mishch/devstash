import Link from 'next/link'
import { redirect } from 'next/navigation'
import { cache, Suspense, type ReactNode } from 'react'
import { Archive, Home, Search, Star, Zap } from 'lucide-react'
import type { WithChildren } from '@/types/common'

import { getCachedSession } from '@/lib/session'
import { loadAppSidebarData } from '@/lib/app/sidebar-data'
import { getEditorPreferences } from '@/lib/db/profile'
import { canCreateCollection, canCreateItem } from '@/lib/db/usage'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'

import { Skeleton } from '@/components/ui/skeleton'
import { SidebarSkeleton } from '@/components/layout/sidebar/sidebar-skeleton'
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
        {/* The chrome (topbar + sidebar) awaits session/sidebar data and
         * suspends on its own. `children` is passed through so it streams
         * independently of that fetch — each route's own `loading.tsx` fills
         * the content area instead of a hardcoded dashboard skeleton. */}
        <DashboardLayoutInner>{children}</DashboardLayoutInner>
      </ItemDrawerProvider>
    </RootProviderShell>
  )
}

interface AppShellProps extends WithChildren {
  topbar: ReactNode
  sidebar: ReactNode
}

/**
 * Static page shell: topbar + sidebar + main containers. Renders synchronously
 * so it never blocks the page content. The data-dependent chrome (sidebar links,
 * topbar create buttons, search) streams in via the `topbar` / `sidebar` slots,
 * each wrapped in its own Suspense by the caller. `children` renders directly in
 * `<main>` so it is never inside a data-suspended boundary — each route's own
 * `loading.tsx` fills the content area instead of a hardcoded dashboard skeleton.
 */
function AppShell({ topbar, sidebar, children }: AppShellProps) {
  return (
    // Desktop: a fixed app-shell (h-screen + overflow-hidden) where only <main> scrolls. Mobile:
    // the *document* scrolls instead — the shell grows past the viewport (min-h-dvh, no overflow
    // lock) and <main> is not its own scroller — so the mobile browser's URL bar collapses on
    // scroll (it only reacts to the root/window scroller, never an inner overflow container). The
    // topbar sticks on mobile so search stays reachable; on desktop it's a static flex child.
    <div className="relative flex min-h-dvh flex-col bg-background lg:h-screen lg:overflow-hidden">
      <header className="app-topbar sticky top-0 z-20 flex h-14 min-w-0 shrink-0 items-center gap-3 border-b border-border px-4 lg:static">
        {topbar}
      </header>

      <div className="flex flex-1 lg:overflow-hidden">
        {sidebar}

        {/* overflow-x-clip (not overflow-x-hidden): `hidden` on one axis with the other left `visible`
            makes CSS coerce the visible axis to `auto`, turning <main> into a vertical scroll
            container on mobile — which swallows the first scroll so the browser URL bar never
            collapses (it only reacts to the document/window scroller) and breaks the window
            virtualizer. `clip` clips horizontal overflow without establishing a scroll container, so
            on mobile the document scrolls. Desktop still scrolls <main> via lg:overflow-y-auto. */}
        <main className="app-dot-grid relative flex min-w-0 flex-1 flex-col overflow-x-clip bg-background lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
          {/* Ambient glow blobs — z-0 so they never cover page content */}
          <div aria-hidden className="pointer-events-none absolute left-1/3 top-0 z-0 h-[500px] w-[600px] -translate-x-1/2 rounded-full bg-blue-500/[0.08] blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute right-0 top-1/3 z-0 h-[400px] w-[500px] rounded-full bg-cyan-500/[0.06] blur-3xl" />
          <div className="relative z-10 flex min-w-0 flex-1 flex-col">
            {/* Cache Components requires uncached page data to sit inside a
             * Suspense boundary. Each route's own `loading.tsx` supplies the
             * real skeleton on navigation; this route-neutral fallback only
             * covers prerender + the brief first-paint window. */}
            <Suspense fallback={<PageContentFallback />}>{children}</Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}

/**
 * Route-neutral content placeholder. Only used as the layout-level Suspense
 * fallback to satisfy Cache Components during prerender and the first-paint
 * window; each route's `loading.tsx` provides the route-specific skeleton on
 * navigation, so this never shows a dashboard-shaped skeleton on settings/profile.
 */
function PageContentFallback() {
  return (
    <div className="app-page gap-6 p-6 animate-pulse">
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  )
}

/** Topbar chrome placeholder shown while the sidebar/session data resolves. */
function TopbarSkeleton() {
  return (
    <>
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
    </>
  )
}

function DashboardLayoutInner({ children }: WithChildren) {
  return (
    <UpgradePromptProvider>
      <AppShell
        topbar={
          <Suspense fallback={<TopbarSkeleton />}>
            <Topbar />
          </Suspense>
        }
        sidebar={
          <Suspense fallback={<SidebarSkeleton collapsible />}>
            <Sidebar />
          </Suspense>
        }
      >
        {children}
      </AppShell>
    </UpgradePromptProvider>
  )
}

/**
 * Resolves session + sidebar data once and renders both chrome slots. Both the
 * topbar and sidebar need the same data, so we share a single cached fetch via
 * `loadChromeData()` (deduplicated by `cache()` across the two Suspense slots).
 */
async function Topbar() {
  const { sidebarData, isPro } = await loadChromeData()

  return (
    <>
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
    </>
  )
}

async function Sidebar() {
  const { sidebarData, isPro, userCanCreateItem, userCanCreateCollection, initialPreferences } =
    await loadChromeData()

  return (
    <>
      <AppUserFlagsInitializer
        isPro={isPro}
        canCreateItem={userCanCreateItem}
        canCreateCollection={userCanCreateCollection}
      />
      <EditorPreferencesInitializer preferences={initialPreferences} />
      <SidebarContent sidebarData={sidebarData} collapsible initialCollapsed={initialPreferences.sidebarCollapsed} />
    </>
  )
}

interface ChromeData {
  sidebarData: Awaited<ReturnType<typeof loadAppSidebarData>>
  isPro: boolean
  userCanCreateItem: boolean
  userCanCreateCollection: boolean
  initialPreferences: ReturnType<typeof normalizeEditorPreferences>
}

const loadChromeData = cache(async (): Promise<ChromeData> => {
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

  return { sidebarData, isPro, userCanCreateItem, userCanCreateCollection, initialPreferences }
})
