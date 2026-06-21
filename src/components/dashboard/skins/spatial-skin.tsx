import Link from 'next/link'
import { Folder, Zap, History, Pin } from 'lucide-react'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { SkinWidget } from './skin-widget'
import { SKIN_HEADER_WRAPPER_CLASS } from './skin-header'
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

      <div className="mb-5 grid grid-cols-[1.3fr_1fr] gap-3 sm:gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className={`${SP_CARD} flex items-center gap-3 px-4 py-3 sm:gap-5 sm:px-5`}>
          <div className={SP_SHEEN} />
          <TotalItemsReveal variant="float" className="relative shrink-0">
            <div className="text-3xl font-extrabold leading-none tracking-[-0.03em]">{stats.totalItems}</div>
            <div className="mt-1 text-sm text-muted-foreground">items stashed</div>
          </TotalItemsReveal>
          <div className="relative min-w-0 flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
              <i className="block h-full rounded-full bg-gradient-to-r from-primary to-cyan-400" style={{ width: `${usage.isPro ? 100 : usage.pct}%` }} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{usageLabel(usage)}</div>
          </div>
        </div>

        <div className={`grid grid-cols-2 gap-4 ${isPro ? '[&>*:last-child]:col-span-2' : ''}`}>
          {minis.map((m) => {
            // A lone mini (Pro, just Collections) reads as a single line — icon + value + label inline.
            const isLone = minis.length === 1
            const inner = (
              <>
                <div className={SP_SHEEN} />
                <m.icon className="relative size-[22px]" style={{ color: m.color }} />
                <div className={isLone ? 'relative flex items-baseline gap-2' : 'relative'}>
                  <div className="text-2xl font-extrabold leading-none">{m.value}</div>
                  <div className={`text-xs text-muted-foreground ${isLone ? '' : 'mt-1'}`}>{m.label}</div>
                </div>
              </>
            )
            // Horizontal layout keeps these minis as short as the slimmed hero. The lone mini centers
            // its single row; the free pair left-aligns icon + value side by side.
            const cls = isLone
              ? `${SP_CARD} flex items-center justify-center gap-3 px-5 py-3 text-center`
              : `${SP_CARD} flex items-center gap-3 px-4 py-3`
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
            <SkinWidget icon={<Pin />} title="Pinned" headerWrapperClassName={SKIN_HEADER_WRAPPER_CLASS.spatial}>
              <DashboardPinnedItems initialItems={pinned} />
            </SkinWidget>
          </div>
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <section className={`${SP_CARD} p-6`}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <SkinWidget icon={<Folder />} title="Collections" headerWrapperClassName={SKIN_HEADER_WRAPPER_CLASS.spatial}>
              <DashboardCollectionsList collections={collections} />
            </SkinWidget>
          </div>
        </section>
        <section className={`${SP_CARD} p-6`}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <SkinWidget icon={<History />} title="Recent items" headerWrapperClassName={SKIN_HEADER_WRAPPER_CLASS.spatial}>
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
