import Link from 'next/link'
import { Folder, Zap, History, Pin } from 'lucide-react'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { SkinWidget } from './skin-widget'
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

  // Favorites + fav. collections are reachable from the header/sidebar star and Collections nav, so
  // those vanity minis are dropped. The hero card already shows the total, leaving Collections as the
  // one useful secondary count (it spans the right column). Free users keep the slots-left mini.
  const minis = [
    { icon: Folder, value: collectionStats.totalCollections, label: 'Collections', color: '#10b981', href: '/collections' as string | undefined },
    ...(isPro
      ? []
      : [{ icon: Zap, value: slotsLeftLabel(usage), label: 'Slots left', color: 'var(--primary)', href: undefined as string | undefined }]),
  ]

  return (
    <div>
      <header className="mb-7">
        <p className="text-sm font-semibold text-primary">Spatial</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Your knowledge hub</h1>
      </header>

      <div className="mb-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className={`${SP_CARD} flex flex-col justify-center p-5`}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <TotalItemsReveal variant="float">
              <div className="text-4xl font-extrabold leading-none tracking-[-0.03em]">{stats.totalItems}</div>
              <div className="mt-1 text-sm text-muted-foreground">items stashed</div>
            </TotalItemsReveal>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-foreground/10">
              <i className="block h-full rounded-full bg-gradient-to-r from-primary to-cyan-400" style={{ width: `${usage.isPro ? 100 : usage.pct}%` }} />
            </div>
            <div className="mt-2.5 text-xs text-muted-foreground">{usageLabel(usage)}</div>
          </div>
        </div>

        <div className={`grid grid-cols-2 gap-4 ${isPro ? '[&>*:last-child]:col-span-2' : ''}`}>
          {minis.map((m) => {
            const inner = (
              <>
                <div className={SP_SHEEN} />
                <m.icon className="relative size-[22px]" style={{ color: m.color }} />
                <div className="relative">
                  <div className="text-2xl font-extrabold leading-none">{m.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{m.label}</div>
                </div>
              </>
            )
            // A lone mini (Pro, just Collections) centers its content so it doesn't read as an empty
            // box when it stretches to the hero's height; the free pair keeps the top/bottom layout.
            const cls =
              minis.length === 1
                ? `${SP_CARD} flex flex-col items-center justify-center gap-2 p-5 text-center`
                : `${SP_CARD} flex flex-col justify-between gap-2 p-3.5`
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
            <SkinWidget icon={<Pin />} title="Pinned">
              <DashboardPinnedItems initialItems={pinned} />
            </SkinWidget>
          </div>
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <section className={`${SP_CARD} p-6`}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <SkinWidget icon={<Folder />} title="Collections">
              <DashboardCollectionsList collections={collections} />
            </SkinWidget>
          </div>
        </section>
        <section className={`${SP_CARD} p-6`}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <SkinWidget icon={<History />} title="Recent items">
              {hasRecent ? <DashboardRecentItems firstPage={recent} /> : <p className="text-sm text-muted-foreground">No items yet.</p>}
            </SkinWidget>
          </div>
        </section>
      </div>

      {/* AI Usage — demoted to the foot of the dashboard: occasional-reassurance data, below content. */}
      {isPro && (
        <section className={`${SP_CARD} mt-5 p-6`}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <AiUsageWidget skin="spatial" />
          </div>
        </section>
      )}
    </div>
  )
}
