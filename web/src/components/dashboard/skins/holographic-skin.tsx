import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Folder, History, Pin } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DashboardData } from '@/hooks/use-dashboard'
import {
  DashboardPinnedItems,
  DashboardRecentItems,
} from '@/components/dashboard/dashboard-item-lists'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { BrainDumpWidget } from '@/components/dashboard/brain-dump-widget'
import { BorderBeam } from '@/components/ui/border-beam'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { SkinWidget } from './skin-widget'
import { computeUsage, usageLabel } from './shared'
import type { SkinLinkTarget } from './shared'

interface HoloCardProps {
  children: ReactNode
  className?: string
  to?: SkinLinkTarget
  /** Override the default inner padding (top widgets use a slimmer pad than content cards). */
  innerClassName?: string
}

function HoloCard({ children, className, to, innerClassName }: HoloCardProps): ReactNode {
  const inner = (
    <div className={cn('ds-holo-inner rounded-[18.5px]', innerClassName ?? 'p-[22px]')}>
      {children}
    </div>
  )
  if (to) {
    return (
      <Link to={to} className={cn('ds-holo-foil block rounded-[20px]', className)}>
        {inner}
      </Link>
    )
  }
  return <div className={cn('ds-holo-foil rounded-[20px]', className)}>{inner}</div>
}

// Holographic (Pro) — iridescent animated foil borders on glossy dark cards.
export function HolographicSkin({
  isPro,
  totalItems,
  totalCollections,
  collections,
  pinned,
  recent,
}: DashboardData): ReactNode {
  const usage = computeUsage(totalItems, isPro)
  const hasRecent = recent.length > 0
  const hasPinned = pinned.length > 0

  return (
    <div>
      <header className="mb-6">
        <p className="ds-holo-text text-sm font-bold">Good to see you</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
          Your knowledge hub
        </h1>
      </header>

      <div
        className={cn(
          'mb-5 grid grid-cols-1 gap-4',
          isPro ? 'sm:grid-cols-[1.4fr_1fr_1.6fr]' : 'sm:grid-cols-[1.6fr_1fr]',
        )}
      >
        <HoloCard className="relative overflow-hidden" innerClassName="px-4 py-3 sm:px-5">
          <div className="flex h-full items-center gap-3 sm:gap-5">
            <TotalItemsReveal variant="pop" className="shrink-0">
              <div className="text-3xl font-extrabold leading-none tracking-[-0.03em]">
                {totalItems}
              </div>
              <div className="mt-1 text-[13px] text-muted-foreground">items stashed</div>
            </TotalItemsReveal>
            <div className="min-w-0 flex-1">
              <div className="h-[7px] overflow-hidden rounded-full bg-foreground/10">
                <i
                  className="block h-full w-[var(--ds-bar-pct)] rounded-full bg-gradient-to-r from-cyan-400 via-violet-500 to-pink-500"
                  // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (usage bar)
                  style={{ '--ds-bar-pct': `${usage.isPro ? 100 : usage.pct}%` }}
                />
              </div>
              <div className="mt-2 text-[13px] text-muted-foreground">{usageLabel(usage)}</div>
            </div>
          </div>
        </HoloCard>
        <HoloCard to="/collections" innerClassName="px-4 py-3 sm:px-5">
          <div className="flex h-full items-baseline gap-2">
            <div className="text-3xl font-extrabold leading-none">{totalCollections}</div>
            <div className="text-[12.5px] text-muted-foreground">Collections</div>
          </div>
        </HoloCard>
        {isPro && <BrainDumpWidget />}
      </div>

      {hasPinned && (
        <div className="mb-4">
          <HoloCard>
            <SkinWidget icon={<Pin />} title="Pinned" skin="holographic">
              <DashboardPinnedItems items={pinned} />
            </SkinWidget>
          </HoloCard>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <HoloCard className="relative overflow-hidden">
          <SkinWidget icon={<History />} title="Recent items" skin="holographic">
            {hasRecent ? (
              <DashboardRecentItems items={recent} />
            ) : (
              <p className="text-sm text-muted-foreground">No items yet.</p>
            )}
          </SkinWidget>
          <BorderBeam size={120} duration={10} className="motion-reduce:hidden" />
        </HoloCard>
        <HoloCard>
          <SkinWidget
            icon={<Folder />}
            title="Collections"
            count={totalCollections}
            skin="holographic"
          >
            <DashboardCollectionsList collections={collections} />
          </SkinWidget>
        </HoloCard>
      </div>

      {isPro && (
        <div className="mt-4">
          <HoloCard>
            <AiUsageWidget skin="holographic" />
          </HoloCard>
        </div>
      )}
    </div>
  )
}
