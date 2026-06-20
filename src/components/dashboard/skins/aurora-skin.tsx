import type { CSSProperties } from 'react'
import Link from 'next/link'
import { Folder, Pin, History, Star, FolderHeart, Zap } from 'lucide-react'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { DotPattern } from '@/components/ui/dot-pattern'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { cn } from '@/lib/utils'
import { SkinCollapsibleSection } from './skin-collapsible-section'
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

  const tiles = [
    { icon: Folder, value: collectionStats.totalCollections, label: 'Collections', color: 'var(--primary)', href: '/collections' },
    { icon: Star, value: stats.favoriteItems, label: 'Favorite items', color: '#fde047', href: '/favorites' },
    { icon: FolderHeart, value: collectionStats.favoriteCollections, label: 'Favorite collections', color: '#8b5cf6', href: '/collections' },
    { icon: Zap, value: slotsLeftLabel(usage), label: usage.isPro ? 'unlimited' : 'Slots left', color: '#10b981', href: undefined as string | undefined },
  ]
  const tileClass = 'ds-glass flex flex-col justify-between gap-3 rounded-2xl p-5 transition-transform hover:-translate-y-0.5'

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

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {/* hero */}
          <div className="ds-glass col-span-2 row-span-2 flex flex-col gap-5 rounded-2xl p-6">
            <div className="flex items-center gap-6">
              <div
                className="ds-ring relative grid size-[120px] shrink-0 place-items-center rounded-full"
                style={{ '--ds-pct': usage.isPro ? 100 : usage.pct } as CSSProperties}
              >
                <TotalItemsReveal variant="pop" align="center" className="relative text-center">
                  <b className="block text-3xl font-extrabold">{stats.totalItems}</b>
                  <span className="text-[11px] text-muted-foreground">total items</span>
                </TotalItemsReveal>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold">{usageLabel(usage)}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {usage.isPro
                    ? 'You have unlimited items, files & AI with Pro.'
                    : `You're using ${usage.pct}% of your free tier. Upgrade to Pro for unlimited items, files & AI.`}
                </p>
              </div>
            </div>
            <TypeDistributionBars distribution={distribution} className="mt-auto" />
          </div>

          {tiles.map((t) => {
            const inner = (
              <>
                <span
                  className="grid size-10 place-items-center rounded-xl"
                  style={{ background: `color-mix(in srgb, ${t.color} 16%, transparent)`, color: t.color }}
                >
                  <t.icon className="size-[19px]" />
                </span>
                <div>
                  <div className="text-[28px] font-extrabold leading-none">{t.value}</div>
                  <div className="mt-1.5 text-[12.5px] text-muted-foreground">{t.label}</div>
                </div>
              </>
            )
            return t.href ? (
              <Link key={t.label} href={t.href} prefetch={false} className={tileClass}>{inner}</Link>
            ) : (
              <div key={t.label} className={tileClass}>{inner}</div>
            )
          })}
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
          <div className="flex flex-col gap-4">
            <section className="ds-glass rounded-2xl p-5">
              <SkinCollapsibleSection icon={<Folder />} title="Collections" count={collectionStats.totalCollections}>
                <CollectionsGrid collections={collections} />
              </SkinCollapsibleSection>
            </section>
            {hasPinned && (
              <section className="ds-glass rounded-2xl p-5">
                <SkinCollapsibleSection icon={<Pin />} title="Pinned">
                  <DashboardPinnedItems initialItems={pinned} />
                </SkinCollapsibleSection>
              </section>
            )}
          </div>

          {hasRecent && (
            <section className="ds-glass rounded-2xl p-5">
              <SkinCollapsibleSection icon={<History />} title="Recent items">
                <DashboardRecentItems firstPage={recent} />
              </SkinCollapsibleSection>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
