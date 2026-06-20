import Link from 'next/link'
import { Pin, History, BarChart3, Folder } from 'lucide-react'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { AnimatedGridPattern } from '@/components/ui/animated-grid-pattern'
import { cn } from '@/lib/utils'
import { SkinCollapsibleSection } from './skin-collapsible-section'
import { computeUsage, slotsLeftLabel, resolveSkinData, TypeDistributionSegments, type DashboardSkinData } from './shared'

const HUD_PANEL = 'rounded-lg border border-border bg-foreground/[0.015] p-5'

// Command Deck (Pro) — HUD/terminal readouts with corner brackets and a segmented type bar.
export async function CommandDeckSkin(data: DashboardSkinData) {
  const { isPro } = data
  const { stats, collectionStats, collections, pinned, recent, distribution } =
    await resolveSkinData(data)
  const usage = computeUsage(stats.totalItems, isPro)
  const hasPinned = pinned.length > 0
  const hasRecent = recent.items.length > 0

  const cells = [
    { label: 'Total Items', value: String(stats.totalItems), pct: usage.isPro ? 100 : usage.pct, sub: usage.isPro ? 'Pro · unlimited' : `${usage.pct}% of free tier (${usage.limit})`, href: undefined as string | undefined },
    { label: 'Collections', value: String(collectionStats.totalCollections).padStart(2, '0'), pct: 40, sub: `${collectionStats.favoriteCollections} favorite`, href: '/collections' },
    { label: 'Favorites', value: String(stats.favoriteItems).padStart(2, '0'), pct: 20, sub: `${stats.favoriteItems} item${stats.favoriteItems === 1 ? '' : 's'}`, href: '/favorites' },
    { label: usage.isPro ? 'Unlimited' : 'Slots Left', value: slotsLeftLabel(usage), pct: 70, sub: 'all changes saved', href: undefined as string | undefined },
  ]
  const cellClass = 'ds-hud-cell relative rounded-md border border-primary/20 bg-gradient-to-b from-primary/[0.04] to-foreground/[0.015] p-[18px]'

  return (
    <div className="relative">
      <AnimatedGridPattern
        numSquares={24}
        maxOpacity={0.06}
        className={cn('inset-x-0 inset-y-[-30%] h-[160%] [mask-image:radial-gradient(60%_60%_at_50%_0%,#000,transparent)]')}
      />
      <div className="relative font-mono">
        <header className="mb-6">
          <p className="text-[13px] font-semibold text-primary">{'// SYSTEM ONLINE'}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">knowledge index synced · {stats.totalItems} records</p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {cells.map((c) => {
            const inner = (
              <>
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-primary">{c.label}</div>
                <div className="mt-2 text-3xl font-extrabold">{c.value}</div>
                <div className="mt-2.5 h-1 overflow-hidden rounded-sm bg-foreground/[0.06]">
                  <i className="block h-full bg-gradient-to-r from-cyan-400 to-primary" style={{ width: `${c.pct}%` }} />
                </div>
                <div className="mt-1.5 text-[10.5px] text-muted-foreground">{c.sub}</div>
              </>
            )
            if (c.href) {
              return <Link key={c.label} href={c.href} prefetch={false} className={`${cellClass} block transition-colors hover:bg-primary/[0.08]`}>{inner}</Link>
            }
            if (c.label === 'Total Items') {
              return (
                <div key={c.label} className={`${cellClass} transition-colors hover:bg-primary/[0.08]`}>
                  <TotalItemsReveal variant="terminal" className="block w-full">{inner}</TotalItemsReveal>
                </div>
              )
            }
            return <div key={c.label} className={cellClass}>{inner}</div>
          })}
        </div>

        <div className="mb-6 rounded-lg border border-border bg-foreground/[0.015] p-5">
          <SkinCollapsibleSection icon={<BarChart3 />} title="Type distribution">
            <TypeDistributionSegments distribution={distribution} />
          </SkinCollapsibleSection>
        </div>

        <div className={`${HUD_PANEL} mb-6`}>
          <SkinCollapsibleSection icon={<Folder />} title="Collections" count={collectionStats.totalCollections}>
            <DashboardCollectionsList collections={collections} />
          </SkinCollapsibleSection>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {hasPinned && (
            <div className={HUD_PANEL}>
              <SkinCollapsibleSection icon={<Pin />} title="Pinned">
                <DashboardPinnedItems initialItems={pinned} />
              </SkinCollapsibleSection>
            </div>
          )}
          {hasRecent && (
            <div className={HUD_PANEL}>
              <SkinCollapsibleSection icon={<History />} title="Recent records">
                <DashboardRecentItems firstPage={recent} />
              </SkinCollapsibleSection>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
