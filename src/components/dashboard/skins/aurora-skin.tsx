import type { CSSProperties } from 'react'
import Link from 'next/link'
import { Folder, Pin, History, Zap } from 'lucide-react'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { DotPattern } from '@/components/ui/dot-pattern'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { cn } from '@/lib/utils'
import { SkinWidget } from './skin-widget'
import {
  computeUsage,
  usageLabel,
  slotsLeftLabel,
  resolveSkinData,
  TypeDistributionBars,
  type DashboardSkinData,
} from './shared'

// Aurora Bento (free) — glassmorphic bento grid with a conic usage ring and per-type bars.
export async function AuroraSkin(data: DashboardSkinData) {
  const { isPro } = data
  const { stats, collectionStats, collections, pinned, recent, distribution } =
    await resolveSkinData(data)
  const usage = computeUsage(stats.totalItems, isPro)
  const hasRecent = recent.items.length > 0
  const hasPinned = pinned.length > 0

  // Favorites + favorite-collections are reachable from the header/sidebar star and Collections nav,
  // so those vanity tiles are dropped. The hero card already shows the total, leaving Collections as
  // the one useful secondary count. Free users keep the slots-left upgrade tile.
  const tiles = [
    { icon: Folder, value: collectionStats.totalCollections, label: 'Collections', color: 'var(--primary)', href: '/collections' as string | undefined },
    ...(isPro
      ? []
      : [{ icon: Zap, value: slotsLeftLabel(usage), label: 'Slots left', color: '#10b981', href: undefined as string | undefined }]),
  ]
  // Slim horizontal stat cards — icon + value + label on one line, matched to the slimmed hero. A lone
  // Collections card (Pro) centers its row; the free pair (Collections + Slots left) left-aligns.
  const loneTile = tiles.length === 1
  const tileClass = loneTile
    ? 'ds-glass flex items-center justify-center gap-3 rounded-2xl px-5 py-3 text-center transition-transform hover:-translate-y-0.5'
    : 'ds-glass flex items-center gap-3 rounded-2xl px-4 py-3 transition-transform hover:-translate-y-0.5'

  return (
    <div className="relative">
      <DotPattern className={cn('opacity-50 [mask-image:radial-gradient(70%_60%_at_50%_0%,#000,transparent)]')} />
      <div className="relative">
        <header className="mb-6">
          <p className="text-sm font-semibold text-primary">Dashboard</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Your knowledge hub</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.totalItems} items · {collectionStats.totalCollections} collections
          </p>
        </header>

        {/* Top: total-items hero + Collections stat, balanced 2-up. The hero is full-width for free
            (so the Slots tile pairs with Collections below it). Type distribution moved to its own
            full-width card below so the hero stays compact and the stat cards aren't oversized. */}
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-2">
          <div className={`ds-glass flex items-center gap-4 rounded-2xl px-5 py-3 ${isPro ? '' : 'col-span-2 lg:col-span-2'}`}>
            <div
              className="ds-ring relative grid size-[64px] shrink-0 place-items-center rounded-full"
              style={{ '--ds-pct': usage.isPro ? 100 : usage.pct } as CSSProperties}
            >
              <TotalItemsReveal variant="pop" align="center" className="relative text-center">
                <b className="block text-xl font-extrabold leading-none">{stats.totalItems}</b>
              </TotalItemsReveal>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold sm:text-base">{usageLabel(usage)}</h3>
              <p className="mt-1 hidden text-[13px] leading-snug text-muted-foreground sm:block">
                {usage.isPro
                  ? 'You have unlimited items, files & AI with Pro.'
                  : `You're using ${usage.pct}% of your free tier. Upgrade to Pro for unlimited items, files & AI.`}
              </p>
            </div>
          </div>

          {tiles.map((t) => {
            const inner = (
              <>
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-xl"
                  style={{ background: `color-mix(in srgb, ${t.color} 16%, transparent)`, color: t.color }}
                >
                  <t.icon className="size-[18px]" />
                </span>
                <div className="text-2xl font-extrabold leading-none">{t.value}</div>
                <div className="text-[12.5px] text-muted-foreground">{t.label}</div>
              </>
            )
            return t.href ? (
              <Link key={t.label} href={t.href} prefetch={false} className={tileClass}>{inner}</Link>
            ) : (
              <div key={t.label} className={tileClass}>{inner}</div>
            )
          })}
        </div>

        <div className="ds-glass mb-6 rounded-2xl p-5">
          <TypeDistributionBars distribution={distribution} />
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
          <div className="flex flex-col gap-4">
            <section className="ds-glass rounded-2xl p-5">
              <SkinWidget icon={<Folder />} title="Collections" count={collectionStats.totalCollections}>
                <CollectionsGrid collections={collections} />
              </SkinWidget>
            </section>
            {hasPinned && (
              <section className="ds-glass rounded-2xl p-5">
                <SkinWidget icon={<Pin />} title="Pinned">
                  <DashboardPinnedItems initialItems={pinned} />
                </SkinWidget>
              </section>
            )}
          </div>

          {hasRecent && (
            <section className="ds-glass rounded-2xl p-5">
              <SkinWidget icon={<History />} title="Recent items">
                <DashboardRecentItems firstPage={recent} />
              </SkinWidget>
            </section>
          )}
        </div>

        {/* AI Usage — demoted to the foot of the dashboard: occasional-reassurance data, below content. */}
        {isPro && (
          <div className="ds-glass mt-6 rounded-2xl p-5">
            <AiUsageWidget skin="aurora" />
          </div>
        )}
      </div>
    </div>
  )
}
