import Link from 'next/link'
import { Folder, Star, FolderHeart, Zap, History, Pin } from 'lucide-react'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { SkinCollapsibleSection } from './skin-collapsible-section'
import { computeUsage, usageLabel, slotsLeftLabel, resolveSkinData, type DashboardSkinData } from './shared'

const SP_CARD =
  'relative overflow-hidden rounded-[28px] border border-foreground/15 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 transition-transform duration-300 hover:-translate-y-1.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0'
const SP_SHEEN =
  'pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,color-mix(in_srgb,var(--foreground)_14%,transparent),transparent_50%)]'

// Spatial Depth (Pro) — visionOS-style frosted floating glass panels with depth + sheen.
export async function SpatialSkin(data: DashboardSkinData) {
  const { isPro } = data
  const { stats, collectionStats, collections, pinned, recent } = await resolveSkinData(data)
  const usage = computeUsage(stats.totalItems, isPro)
  const hasRecent = recent.items.length > 0
  const hasPinned = pinned.length > 0

  const minis = [
    { icon: Folder, value: collectionStats.totalCollections, label: 'Collections', color: '#10b981', href: '/collections' as string | undefined },
    { icon: Star, value: stats.favoriteItems, label: 'Favorites', color: '#fde047', href: '/favorites' as string | undefined },
    { icon: FolderHeart, value: collectionStats.favoriteCollections, label: 'Fav. collections', color: '#8b5cf6', href: '/collections' as string | undefined },
    { icon: Zap, value: slotsLeftLabel(usage), label: usage.isPro ? 'unlimited' : 'Slots left', color: 'var(--primary)', href: undefined as string | undefined },
  ]

  return (
    <div>
      <header className="mb-7">
        <p className="text-sm font-semibold text-primary">Spatial</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Your knowledge hub</h1>
      </header>

      <div className="mb-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className={`${SP_CARD} flex flex-col justify-center p-8`}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <TotalItemsReveal variant="float">
              <div className="text-6xl font-extrabold leading-none tracking-[-0.03em]">{stats.totalItems}</div>
              <div className="mt-1 text-sm text-muted-foreground">items stashed</div>
            </TotalItemsReveal>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-foreground/10">
              <i className="block h-full rounded-full bg-gradient-to-r from-primary to-cyan-400" style={{ width: `${usage.isPro ? 100 : usage.pct}%` }} />
            </div>
            <div className="mt-2.5 text-xs text-muted-foreground">{usageLabel(usage)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {minis.map((m) => {
            const inner = (
              <>
                <div className={SP_SHEEN} />
                <m.icon className="relative size-[22px]" style={{ color: m.color }} />
                <div className="relative">
                  <div className="text-[28px] font-extrabold">{m.value}</div>
                  <div className="text-xs text-muted-foreground">{m.label}</div>
                </div>
              </>
            )
            const cls = `${SP_CARD} flex flex-col justify-between gap-3 p-5`
            return m.href ? (
              <Link key={m.label} href={m.href} prefetch={false} className={cls}>{inner}</Link>
            ) : (
              <div key={m.label} className={cls}>{inner}</div>
            )
          })}
        </div>
      </div>

      {hasPinned && (
        <section className={`${SP_CARD} mb-5 p-6`}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <SkinCollapsibleSection icon={<Pin />} title="Pinned">
              <DashboardPinnedItems initialItems={pinned} />
            </SkinCollapsibleSection>
          </div>
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <section className={`${SP_CARD} p-6`}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <SkinCollapsibleSection icon={<Folder />} title="Collections">
              <DashboardCollectionsList collections={collections} />
            </SkinCollapsibleSection>
          </div>
        </section>
        <section className={`${SP_CARD} p-6`}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <SkinCollapsibleSection icon={<History />} title="Recent items">
              {hasRecent ? <DashboardRecentItems firstPage={recent} /> : <p className="text-sm text-muted-foreground">No items yet.</p>}
            </SkinCollapsibleSection>
          </div>
        </section>
      </div>
    </div>
  )
}
