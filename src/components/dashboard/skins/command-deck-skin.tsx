import { Pin, History, BarChart3, Folder } from 'lucide-react'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { BrainDumpWidget } from '@/components/dashboard/brain-dump-widget'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { RetroGrid } from '@/components/ui/retro-grid'
import { cn } from '@/lib/utils'
import { SkinWidget } from './skin-widget'
import { computeUsage, resolveSkinData, MaybeLink, TypeDistributionSegments, type DashboardSkinData } from './shared'

const HUD_PANEL = 'relative overflow-hidden rounded-lg border border-border bg-foreground/[0.015] p-5 transition-colors duration-300 hover:bg-foreground/[0.035]'

// Command Deck (Pro) — HUD/terminal readouts with corner brackets and a segmented type bar.
export async function CommandDeckSkin(data: DashboardSkinData) {
  const { isPro } = data
  const { stats, collectionStats, collections, pinned, recent, distribution } =
    await resolveSkinData(data)
  const usage = computeUsage(stats.totalItems, isPro)
  const hasPinned = pinned.length > 0
  const hasRecent = recent.items.length > 0

  // Favorites is reachable from the header/sidebar star, so the vanity Favorites readout is dropped
  // (Total + Collections are the useful counts). Free keeps the slots-left readout; "free tier" copy
  // only ever shows to non-Pro. The slots-left cell only renders for non-Pro.
  const cells = [
    { label: 'Total Items', value: String(stats.totalItems), pct: usage.isPro ? 100 : usage.pct, sub: usage.isPro ? 'Pro · unlimited' : `${usage.pct}% of free tier (${usage.limit})`, href: undefined as string | undefined },
    { label: 'Collections', value: String(collectionStats.totalCollections).padStart(2, '0'), pct: 40, sub: `${collectionStats.favoriteCollections} favorite`, href: '/collections' as string | undefined },
    ...(isPro
      ? []
      : [{ label: 'Slots Left', value: String(usage.slotsLeft), pct: 70, sub: 'all changes saved', href: undefined as string | undefined }]),
  ]
  const cellClass = 'ds-hud-cell relative rounded-md border border-primary/20 bg-gradient-to-b from-primary/[0.04] to-foreground/[0.015] px-[18px] py-3'
  // Pro: Total + Collections stay compact and Brain Dump takes a wide cell (spans 2 of a 4-col track),
  // replacing the standalone banner. Free has 3 cells; the odd last (Slots Left) spans the full row on
  // the 2-col grid so it is never orphaned, resolving to its own column at lg.
  const cellGridCols = isPro
    ? 'lg:grid-cols-4'
    : 'lg:grid-cols-3 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1'

  return (
    // overflow-hidden clips the RetroGrid's perspective bleed. The grid sits at the top as a faint
    // HUD horizon, radial-masked so it fades out below the header and away from center.
    <div className="relative overflow-hidden">
      <RetroGrid
        className={cn('inset-x-0 bottom-auto top-0 h-[42vh] [mask-image:radial-gradient(70%_70%_at_50%_0%,#000,transparent)]')}
        opacity={0.14}
        angle={70}
      />
      <div className="relative font-mono">
        <header className="mb-6">
          <p className="text-[13px] font-semibold text-primary">{'// SYSTEM ONLINE'}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">knowledge index synced · {stats.totalItems} records</p>
        </header>

        <div className={cn('mb-6 grid grid-cols-2 gap-3.5', cellGridCols)}>
          {cells.map((c) => {
            // Compact readout for the wide 2-up cells: label + value share the top row with the sub on
            // the right (no separate stacked sub line), bar underneath — roughly half the old height.
            const inner = (
              <>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10.5px] uppercase tracking-[0.14em] text-primary">{c.label}</div>
                    <div className="mt-1 text-2xl font-extrabold leading-none">{c.value}</div>
                  </div>
                  <div className="truncate text-[10.5px] text-muted-foreground">{c.sub}</div>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-sm bg-foreground/[0.06]">
                  <i className="block h-full bg-gradient-to-r from-cyan-400 to-primary" style={{ width: `${c.pct}%` }} />
                </div>
              </>
            )
            if (c.label === 'Total Items') {
              return (
                <div key={c.label} className={`${cellClass} card-interactive`}>
                  <TotalItemsReveal variant="terminal" className="block w-full">{inner}</TotalItemsReveal>
                </div>
              )
            }
            return (
              <MaybeLink key={c.label} href={c.href} className={c.href ? `${cellClass} card-interactive block` : cellClass}>{inner}</MaybeLink>
            )
          })}
          {isPro && <BrainDumpWidget skin="command-deck" className="col-span-2" />}
        </div>

        <div className={`${HUD_PANEL} mb-6`}>
          <SkinWidget icon={<Folder />} title="Collections" count={collectionStats.totalCollections} skin="command-deck" headerHoverless>
            <DashboardCollectionsList collections={collections} />
          </SkinWidget>
        </div>

        <div className="mb-6 grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {hasPinned && (
            <div className={HUD_PANEL}>
              <SkinWidget icon={<Pin />} title="Pinned" skin="command-deck" headerHoverless>
                <DashboardPinnedItems initialItems={pinned} />
              </SkinWidget>
            </div>
          )}
          {hasRecent && (
            <div className={HUD_PANEL}>
              <SkinWidget icon={<History />} title="Recent records" skin="command-deck" headerHoverless>
                <DashboardRecentItems firstPage={recent} />
              </SkinWidget>
            </div>
          )}
        </div>

        {/* Type distribution — analytics, below the content lists. */}
        <div className={`${HUD_PANEL} mb-6`}>
          <SkinWidget icon={<BarChart3 />} title="Type distribution" skin="command-deck" headerHoverless>
            <TypeDistributionSegments distribution={distribution} />
          </SkinWidget>
        </div>

        {/* AI Usage — demoted to the foot of the dashboard: occasional-reassurance data, below content. */}
        {isPro && (
          <div className={`${HUD_PANEL} mt-6`}>
            <AiUsageWidget skin="command-deck" />
          </div>
        )}
      </div>
    </div>
  )
}
