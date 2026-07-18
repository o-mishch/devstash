import type { ReactNode } from 'react'
import { Folder, History, Pin, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DashboardData } from '@/hooks/use-dashboard'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import {
  DashboardPinnedItems,
  DashboardRecentItems,
} from '@/components/dashboard/dashboard-item-lists'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { BrainDumpWidget } from '@/components/dashboard/brain-dump-widget'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { cn } from '@/lib/utils'
import { SkinWidget } from './skin-widget'
import { computeUsage, usageLabel, MaybeLink } from './shared'
import type { SkinLinkTarget } from './shared'

const SP_CARD =
  'relative overflow-hidden rounded-[28px] border border-foreground/15 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--card)_60%,var(--foreground)_2.5%)] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 transition-all duration-300 hover:-translate-y-1.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0'
const SP_SHEEN =
  'pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,color-mix(in_srgb,var(--foreground)_14%,transparent),transparent_50%)]'

interface SpatialMini {
  icon: LucideIcon
  value: number | string
  label: string
  color: string
  to?: SkinLinkTarget
}

type SpatialSkinProps = DashboardData

// Spatial Depth (Pro) — visionOS-style frosted floating glass panels with depth + sheen.
export function SpatialSkin({
  isPro,
  totalItems,
  totalCollections,
  collections,
  pinned,
  recent,
}: SpatialSkinProps): ReactNode {
  const usage = computeUsage(totalItems, isPro)
  const hasRecent = recent.length > 0
  const hasPinned = pinned.length > 0

  const minis: SpatialMini[] = [
    {
      icon: Folder,
      value: totalCollections,
      label: 'Collections',
      color: '#10b981',
      to: '/collections',
    },
    ...(isPro
      ? []
      : [
          {
            icon: Zap,
            value: String(usage.slotsLeft),
            label: 'Slots left',
            color: 'var(--primary)',
          },
        ]),
  ]

  return (
    <div>
      <header className="mb-7">
        <p className="text-sm font-semibold text-primary">Spatial</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
          Your knowledge hub
        </h1>
      </header>

      <div
        className={cn(
          'mb-5 grid grid-cols-[1.3fr_1fr] gap-3 sm:gap-5',
          isPro ? 'lg:grid-cols-[1fr_0.9fr_1.6fr]' : 'lg:grid-cols-[1fr_1.4fr]',
        )}
      >
        <div className={cn(SP_CARD, 'flex items-center gap-3 px-4 py-3 sm:gap-5 sm:px-5')}>
          <div className={SP_SHEEN} />
          <TotalItemsReveal variant="float" className="relative shrink-0">
            <div className="text-3xl font-extrabold leading-none tracking-[-0.03em]">
              {totalItems}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">items stashed</div>
          </TotalItemsReveal>
          <div className="relative min-w-0 flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
              <i
                className="block h-full w-[var(--ds-bar-pct)] rounded-full bg-gradient-to-r from-primary to-cyan-400"
                // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (usage bar)
                style={{ '--ds-bar-pct': `${usage.isPro ? 100 : usage.pct}%` }}
              />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{usageLabel(usage)}</div>
          </div>
        </div>

        <div className={cn('grid grid-cols-2 gap-4', isPro && '[&>*:last-child]:col-span-2')}>
          {minis.map((m) => {
            const isLone = minis.length === 1
            const cls = cn(
              SP_CARD,
              isLone
                ? 'flex items-center justify-center gap-3 px-5 py-3 text-center'
                : 'flex items-center gap-3 px-4 py-3',
            )
            return (
              <MaybeLink key={m.label} to={m.to} className={cls}>
                <div className={SP_SHEEN} />
                <m.icon
                  className="relative size-[22px] text-[var(--ds-mini-color)]"
                  // dynamic CSS custom property (per-mini accent color)
                  style={{ '--ds-mini-color': m.color }}
                />
                <div className={isLone ? 'relative flex items-baseline gap-2' : 'relative'}>
                  <div className="text-2xl font-extrabold leading-none">{m.value}</div>
                  <div className={cn('text-xs text-muted-foreground', !isLone && 'mt-1')}>
                    {m.label}
                  </div>
                </div>
              </MaybeLink>
            )
          })}
        </div>

        {isPro && <BrainDumpWidget className="col-span-2 lg:col-span-1" />}
      </div>

      {hasPinned && (
        <section className={cn(SP_CARD, 'mb-5 p-6')}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <SkinWidget icon={<Pin />} title="Pinned" skin="spatial">
              <DashboardPinnedItems items={pinned} />
            </SkinWidget>
          </div>
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <section className={cn(SP_CARD, 'p-6')}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <SkinWidget icon={<Folder />} title="Collections" skin="spatial">
              <DashboardCollectionsList collections={collections} />
            </SkinWidget>
          </div>
        </section>
        <section className={cn(SP_CARD, 'p-6')}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <SkinWidget icon={<History />} title="Recent items" skin="spatial">
              {hasRecent ? (
                <DashboardRecentItems items={recent} />
              ) : (
                <p className="text-sm text-muted-foreground">No items yet.</p>
              )}
            </SkinWidget>
          </div>
        </section>
      </div>

      {isPro && (
        <section className={cn(SP_CARD, 'mt-5 p-6')}>
          <div className={SP_SHEEN} />
          <div className="relative">
            <AiUsageWidget skin="spatial" />
          </div>
        </section>
      )}
    </div>
  )
}
