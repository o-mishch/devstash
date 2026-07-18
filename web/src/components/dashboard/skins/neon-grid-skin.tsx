import type { CSSProperties, ReactNode } from 'react'
import { Folder, History, Pin } from 'lucide-react'
import type { DashboardData } from '@/hooks/use-dashboard'
import {
  DashboardPinnedItems,
  DashboardRecentItems,
} from '@/components/dashboard/dashboard-item-lists'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { BrainDumpWidget } from '@/components/dashboard/brain-dump-widget'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { RetroGrid } from '@/components/ui/retro-grid'
import { cn } from '@/lib/utils'
import { SkinWidget } from './skin-widget'
import { computeUsage, MaybeLink, statGridColsClass, TypeDistributionSegments } from './shared'
import type { SkinLinkTarget } from './shared'

const NEON_CELL =
  'rounded-lg border bg-[color-mix(in_srgb,var(--card)_60%,transparent)] px-4 py-3 backdrop-blur'
const NEON_PANEL =
  'relative z-10 overflow-hidden rounded-lg border border-primary/30 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--card)_60%,var(--foreground)_2.5%)] p-5 backdrop-blur transition-colors duration-300'
// Held in a const so the leading `//` isn't parsed as a stray JSX comment textnode.
const STATUS_TAG = '// knowledge.exe running'

interface NeonCell {
  value: string
  label: string
  color: string
  to?: SkinLinkTarget
}

// Neon Grid (Pro) — synthwave neon outlines over an animated perspective grid horizon.
export function NeonGridSkin({
  isPro,
  totalItems,
  totalCollections,
  distribution,
  collections,
  pinned,
  recent,
}: DashboardData): ReactNode {
  const usage = computeUsage(totalItems, isPro)
  const hasRecent = recent.length > 0
  const hasPinned = pinned.length > 0

  const cells: NeonCell[] = [
    { value: String(totalItems), label: 'total items', color: 'var(--primary)' },
    {
      value: `${totalCollections}`.padStart(2, '0'),
      label: 'collections',
      color: '#ec4899',
      to: '/collections',
    },
    ...(isPro ? [] : [{ value: String(usage.slotsLeft), label: 'slots left', color: '#22d3ee' }]),
  ]
  const cellGridCols = statGridColsClass(cells.length === 2)

  return (
    <div className="relative min-h-[70vh]">
      <RetroGrid className="inset-x-0 bottom-0 top-auto h-[45vh]" opacity={0.35} angle={65} />
      <div className="relative z-10">
        <header className="mb-6">
          <p className="font-mono text-[13px] text-primary">{STATUS_TAG}</p>
          <h1 className="mt-1 font-mono text-2xl font-extrabold tracking-[0.06em] sm:text-3xl [text-shadow:0_0_18px_color-mix(in_srgb,var(--primary)_60%,transparent)]">
            DASHBOARD
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalItems} records indexed · grid online
          </p>
        </header>

        <div className={cn('mb-6 grid grid-cols-2 gap-4', cellGridCols)}>
          {cells.map((c) => (
            <NeonCellView key={c.label} cell={c} />
          ))}
          {isPro && <BrainDumpWidget className="col-span-2" />}
        </div>

        {hasPinned && (
          <div className={cn(NEON_PANEL, 'mb-4')}>
            <SkinWidget
              icon={<Pin />}
              title="Pinned"
              headerClassName="font-mono tracking-[0.1em] text-primary"
              skin="neon-grid"
            >
              <DashboardPinnedItems items={pinned} />
            </SkinWidget>
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
          <div className={NEON_PANEL}>
            <SkinWidget
              title="Recent records"
              headerClassName="font-mono tracking-[0.1em] text-primary"
              skin="neon-grid"
            >
              {hasRecent ? (
                <DashboardRecentItems items={recent} />
              ) : (
                <p className="text-sm text-muted-foreground">No items yet.</p>
              )}
            </SkinWidget>
          </div>
          <div className={NEON_PANEL}>
            <SkinWidget
              icon={<Folder />}
              title="Collections"
              headerClassName="font-mono tracking-[0.1em] text-primary"
              skin="neon-grid"
            >
              <DashboardCollectionsList collections={collections} />
            </SkinWidget>
            <div className="mt-5">
              <SkinWidget
                icon={<History />}
                title="Distribution"
                headerClassName="font-mono tracking-[0.1em] text-primary"
              >
                <TypeDistributionSegments distribution={distribution} />
              </SkinWidget>
            </div>
          </div>
        </div>

        {isPro && (
          <div className={cn(NEON_PANEL, 'mt-6')}>
            <AiUsageWidget skin="neon-grid" />
          </div>
        )}
      </div>
    </div>
  )
}

interface NeonCellViewProps {
  cell: NeonCell
}

function NeonCellView({ cell: c }: NeonCellViewProps): ReactNode {
  const style: CSSProperties = { '--ds-neon-color': c.color }
  const inner = (
    <>
      <div className="font-mono text-2xl font-extrabold leading-none">{c.value}</div>
      <div className="mt-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {c.label}
      </div>
    </>
  )

  if (c.label === 'total items') {
    return (
      <div
        className={`${NEON_CELL} ds-neon-tint transition-transform hover:-translate-y-0.5`}
        // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (neon cell accent)
        style={style}
      >
        <TotalItemsReveal variant="neon" className="block w-full">
          {inner}
        </TotalItemsReveal>
      </div>
    )
  }
  return (
    <MaybeLink
      to={c.to}
      className={
        c.to
          ? `${NEON_CELL} ds-neon-tint block transition-transform hover:-translate-y-0.5`
          : `${NEON_CELL} ds-neon-tint`
      }
      // oxlint-disable-next-line react/forbid-component-props -- dynamic CSS custom property (neon cell accent)
      style={style}
    >
      {inner}
    </MaybeLink>
  )
}
