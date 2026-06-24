import { History, Folder, Pin } from 'lucide-react'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { BrainDumpWidget } from '@/components/dashboard/brain-dump-widget'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { RetroGrid } from '@/components/ui/retro-grid'
import { cn } from '@/lib/utils'
import { SkinWidget } from './skin-widget'
import { computeUsage, resolveSkinData, MaybeLink, TypeDistributionSegments, type DashboardSkinData } from './shared'

const NEON_CELL = 'rounded-lg border bg-[color-mix(in_srgb,var(--card)_60%,transparent)] px-4 py-3 backdrop-blur'
const NEON_PANEL = 'relative z-10 overflow-hidden rounded-lg border border-primary/30 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--card)_60%,var(--foreground)_2.5%)] p-5 backdrop-blur transition-colors duration-300'

// Neon Grid (Pro) — synthwave neon outlines over an animated perspective grid horizon.
export async function NeonGridSkin(data: DashboardSkinData) {
  const { isPro } = data
  const { stats, collectionStats, collections, pinned, recent, distribution } =
    await resolveSkinData(data)
  const usage = computeUsage(stats.totalItems, isPro)
  const hasRecent = recent.items.length > 0
  const hasPinned = pinned.length > 0

  // Favorites + fav. collections are reachable from the header/sidebar star and Collections nav, so
  // those vanity cells are dropped (Total + Collections are the useful counts). Free keeps slots-left.
  const cells = [
    { value: String(stats.totalItems), label: 'total items', color: 'var(--primary)', href: undefined as string | undefined },
    { value: String(collectionStats.totalCollections).padStart(2, '0'), label: 'collections', color: '#ec4899', href: '/collections' as string | undefined },
    ...(isPro
      ? []
      : [{ value: String(usage.slotsLeft), label: 'slots left', color: '#22d3ee', href: undefined as string | undefined }]),
  ]
  // Pro is Total + Collections beside a wide 2-col Brain Dump cell (4-col track). Free has 3 cells;
  // the odd last (slots left) spans the full row on the 2-col grid so it is never orphaned, resolving
  // to its own column at lg.
  const cellGridCols =
    cells.length === 2
      ? 'lg:grid-cols-4'
      : 'lg:grid-cols-3 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1'

  return (
    <div className="relative min-h-[70vh]">
      <RetroGrid className="inset-x-0 bottom-0 top-auto h-[45vh]" opacity={0.35} angle={65} />
      <div className="relative z-10">
        <header className="mb-6">
          <p className="font-mono text-[13px] text-primary">{'// knowledge.exe running'}</p>
          <h1 className="mt-1 font-mono text-2xl font-extrabold tracking-[0.06em] sm:text-3xl [text-shadow:0_0_18px_color-mix(in_srgb,var(--primary)_60%,transparent)]">
            DASHBOARD
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{stats.totalItems} records indexed · grid online</p>
        </header>

        <div className={cn('mb-6 grid grid-cols-2 gap-4', cellGridCols)}>
          {cells.map((c) => {
            const style = { borderColor: c.color, boxShadow: `0 0 24px -6px ${c.color}, inset 0 0 24px -14px ${c.color}` }
            const inner = (
              <>
                <div className="font-mono text-2xl font-extrabold leading-none">{c.value}</div>
                <div className="mt-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{c.label}</div>
              </>
            )
            if (c.label === 'total items') {
              return (
                <div key={c.label} className={`${NEON_CELL} transition-transform hover:-translate-y-0.5`} style={style}>
                  <TotalItemsReveal variant="neon" className="block w-full">{inner}</TotalItemsReveal>
                </div>
              )
            }
            return (
              <MaybeLink key={c.label} href={c.href} className={c.href ? `${NEON_CELL} block transition-transform hover:-translate-y-0.5` : NEON_CELL} style={style}>{inner}</MaybeLink>
            )
          })}

          {isPro && <BrainDumpWidget skin="neon-grid" className="col-span-2" />}
        </div>

        {hasPinned && (
          <div className={`${NEON_PANEL} mb-4`}>
            <SkinWidget icon={<Pin />} title="Pinned" headerClassName="font-mono tracking-[0.1em] text-primary" skin="neon-grid">
              <DashboardPinnedItems initialItems={pinned} />
            </SkinWidget>
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
          <div className={NEON_PANEL}>
            <SkinWidget title="Recent records" headerClassName="font-mono tracking-[0.1em] text-primary" skin="neon-grid">
              {hasRecent ? <DashboardRecentItems firstPage={recent} /> : <p className="text-sm text-muted-foreground">No items yet.</p>}
            </SkinWidget>
          </div>
          <div className={NEON_PANEL}>
            <SkinWidget icon={<Folder />} title="Collections" headerClassName="font-mono tracking-[0.1em] text-primary" skin="neon-grid">
              <DashboardCollectionsList collections={collections} />
            </SkinWidget>
            <div className="mt-5">
              <SkinWidget icon={<History />} title="Distribution" headerClassName="font-mono tracking-[0.1em] text-primary">
                <TypeDistributionSegments distribution={distribution} />
              </SkinWidget>
            </div>
          </div>
        </div>

        {/* AI Usage — demoted to the foot of the dashboard: occasional-reassurance data, below content. */}
        {isPro && (
          <div className={`${NEON_PANEL} mt-6`}>
            <AiUsageWidget skin="neon-grid" />
          </div>
        )}
      </div>
    </div>
  )
}
