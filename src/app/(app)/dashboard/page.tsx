import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import { getCachedSession } from '@/lib/session'
import { getCollectionsPreview, getCollectionStats } from '@/lib/db/collections'
import {
  getItemStats,
  getRecentItemsPage,
  getPinnedItems,
  getItemTypeDistribution,
  getDashboardActivity,
} from '@/lib/db/items'
import { getEditorPreferences } from '@/lib/db/profile'
import { loadAppSidebarData } from '@/lib/app/sidebar-data'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { normalizeEditorPreferences } from '@/lib/utils/editor-preferences'
import { resolveAccessibleSkin } from '@/types/editor-preferences'
import type { UiSkin } from '@/types/editor-preferences'
import type { ItemTypeDistribution } from '@/types/item'
import { Button } from '@/components/ui/button'
import { CreateItemDialog } from '@/components/items/item-create-dialog'
import { DashboardSkinShell } from '@/components/dashboard/dashboard-content'
import { DashboardSkinFallback } from '@/components/dashboard/skins/skeletons'

// Skins that render a type-distribution viz (bars/segments/donut). Others (classic, spatial,
// holographic) never read the distribution, so the query is skipped for them.
const SKINS_WITH_TYPE_DISTRIBUTION: ReadonlySet<UiSkin> = new Set([
  'aurora',
  'editorial',
  'command-deck',
  'orbital',
  'neon-grid',
  'mission-control',
])

export default async function DashboardPage() {
  const session = await getCachedSession()
  const userId = session?.user?.id
  if (!userId) redirect('/sign-in')

  // Resolve the skin server-side from persisted prefs and enforce the Pro gate (a free user whose
  // stored skin is Pro-only falls back to the default) so the correct layout renders on first paint.
  const [prefs, isPro] = await Promise.all([
    getEditorPreferences(userId).catch(() => null),
    getCachedVerifiedProAccess(userId),
  ])
  const skin = resolveAccessibleSkin(normalizeEditorPreferences(prefs).uiSkin, isPro)

  // stats is needed to branch the empty state before kicking off the rest — it's 'use cache' so it
  // resolves fast. The other fetches are created only after this branch so an empty (0-item) account
  // doesn't fire (and leave unawaited) the collections/recent/pinned/distribution queries.
  const stats = await getItemStats(userId)

  if (stats.totalItems === 0) {
    const sidebarData = await loadAppSidebarData(session)
    return (
      <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center sm:p-12 mt-4 bg-muted/20">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Plus className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">Welcome to DevStash!</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mb-6">
            Your dashboard is looking a bit empty. Let&apos;s get started by creating your first item.
          </p>
          <CreateItemDialog
            itemTypes={sidebarData.itemTypes}
            collections={sidebarData.collections}
            trigger={<Button>Create your first item &rarr;</Button>}
          />
        </div>
      </div>
    )
  }

  // Account is non-empty — kick off the remaining parallel fetches (all backed by 'use cache').
  // stats is already resolved, so hand it down as a settled promise to keep the shell's API uniform.
  const statsPromise = Promise.resolve(stats)
  const collectionsPromise = getCollectionsPreview(userId)
  const recentItemsPromise = getRecentItemsPage(userId)
  const pinnedItemsPromise = getPinnedItems(userId)
  const collectionStatsPromise = getCollectionStats(userId)
  // Only the skins that render a type-distribution viz consume this — gate the fetch so the default
  // (classic) and the CSS-only skins (spatial, holographic) don't pay for an unused groupBy or leave
  // it as a floating, unawaited promise.
  const typeDistributionPromise = SKINS_WITH_TYPE_DISTRIBUTION.has(skin)
    ? getItemTypeDistribution(userId)
    : Promise.resolve<ItemTypeDistribution[]>([])
  // Only the mission-control skin consumes the activity series — gate the fetch.
  const activityPromise = skin === 'mission-control' ? getDashboardActivity(userId) : undefined

  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6" data-skin={skin}>
      <Suspense fallback={<DashboardSkinFallback skin={skin} isPro={isPro} />}>
        <DashboardSkinShell
          skin={skin}
          isPro={isPro}
          statsPromise={statsPromise}
          collectionStatsPromise={collectionStatsPromise}
          collectionsPromise={collectionsPromise}
          recentItemsPromise={recentItemsPromise}
          pinnedItemsPromise={pinnedItemsPromise}
          typeDistributionPromise={typeDistributionPromise}
          activityPromise={activityPromise}
        />
      </Suspense>
    </div>
  )
}
