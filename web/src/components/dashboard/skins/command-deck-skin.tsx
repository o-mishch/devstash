import type { ReactNode } from 'react'
import { BarChart3, Folder, History, Pin } from 'lucide-react'
import type { DashboardData } from '@/hooks/use-dashboard'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import {
  DashboardPinnedItems,
  DashboardRecentItems,
} from '@/components/dashboard/dashboard-item-lists'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { BrainDumpWidget } from '@/components/dashboard/brain-dump-widget'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { RetroGrid } from '@/components/ui/retro-grid'
import { cn } from '@/lib/utils'
import { SkinWidget } from './skin-widget'
import { computeUsage, MaybeLink, statGridColsClass, TypeDistributionSegments } from './shared'
import type { SkinLinkTarget } from './shared'

const HUD_PANEL =
  'relative overflow-hidden rounded-lg border border-border bg-foreground/[0.015] p-5 transition-colors duration-300 hover:bg-foreground/[0.035]'
const CELL_CLASS =
  'ds-hud-cell relative rounded-md border border-primary/20 bg-gradient-to-b from-primary/[0.04] to-foreground/[0.015] px-[18px] py-3'
// Held in a const so the leading `//` isn't parsed as a stray JSX comment textnode.
const STATUS_TAG = '// SYSTEM ONLINE'

interface HudCell {
  label: string
  value: string
  pct: number
  sub: string
  to?: SkinLinkTarget
}

type CommandDeckSkinProps = DashboardData

// Command Deck (Pro) — HUD/terminal readouts with corner brackets and a segmented type bar.
export function CommandDeckSkin({
  isPro,
  totalItems,
  totalCollections,
  favoriteCollections,
  distribution,
  collections,
  pinned,
  recent,
}: CommandDeckSkinProps): ReactNode {
  const usage = computeUsage(totalItems, isPro)
  const hasPinned = pinned.length > 0
  const hasRecent = recent.length > 0

  const cells: HudCell[] = [
    {
      label: 'Total Items',
      value: String(totalItems),
      pct: usage.isPro ? 100 : usage.pct,
      sub: usage.isPro ? 'Pro · unlimited' : `${usage.pct}% of free tier (${usage.limit})`,
    },
    {
      label: 'Collections',
      value: String(totalCollections).padStart(2, '0'),
      pct: 40,
      sub: `${favoriteCollections} favorite`,
      to: '/collections',
    },
    ...(isPro
      ? []
      : [
          {
            label: 'Slots Left',
            value: String(usage.slotsLeft),
            pct: 70,
            sub: 'all changes saved',
          },
        ]),
  ]
  const cellGridCols = statGridColsClass(isPro)

  return (
    <div className="relative overflow-hidden">
      <RetroGrid
        className={cn(
          'inset-x-0 bottom-auto top-0 h-[42vh] [mask-image:radial-gradient(70%_70%_at_50%_0%,#000,transparent)]',
        )}
        opacity={0.14}
        angle={70}
      />
      <div className="relative font-mono">
        <header className="mb-6">
          <p className="text-[13px] font-semibold text-primary">{STATUS_TAG}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            knowledge index synced · {totalItems} records
          </p>
        </header>

        <div className={cn('mb-6 grid grid-cols-2 gap-3.5', cellGridCols)}>
          {cells.map((c) => (
            <HudCellView key={c.label} cell={c} />
          ))}
          {isPro && <BrainDumpWidget className="col-span-2" />}
        </div>

        <div className={`${HUD_PANEL} mb-6`}>
          <SkinWidget
            icon={<Folder />}
            title="Collections"
            count={totalCollections}
            skin="command-deck"
            headerHoverless
          >
            <DashboardCollectionsList collections={collections} />
          </SkinWidget>
        </div>

        <div className="mb-6 grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {hasPinned && (
            <div className={HUD_PANEL}>
              <SkinWidget icon={<Pin />} title="Pinned" skin="command-deck" headerHoverless>
                <DashboardPinnedItems items={pinned} />
              </SkinWidget>
            </div>
          )}
          {hasRecent && (
            <div className={HUD_PANEL}>
              <SkinWidget
                icon={<History />}
                title="Recent records"
                skin="command-deck"
                headerHoverless
              >
                <DashboardRecentItems items={recent} />
              </SkinWidget>
            </div>
          )}
        </div>

        <div className={`${HUD_PANEL} mb-6`}>
          <SkinWidget
            icon={<BarChart3 />}
            title="Type distribution"
            skin="command-deck"
            headerHoverless
          >
            <TypeDistributionSegments distribution={distribution} />
          </SkinWidget>
        </div>

        {isPro && (
          <div className={`${HUD_PANEL} mt-6`}>
            <AiUsageWidget skin="command-deck" />
          </div>
        )}
      </div>
    </div>
  )
}

interface HudCellViewProps {
  cell: HudCell
}

function HudCellView({ cell: c }: HudCellViewProps): ReactNode {
  const inner = (
    <>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-primary">{c.label}</div>
          <div className="mt-1 text-2xl font-extrabold leading-none">{c.value}</div>
        </div>
        <div className="truncate text-[10.5px] text-muted-foreground">{c.sub}</div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-sm bg-foreground/[0.06]">
        <div
          className="block h-full w-[var(--ds-bar-pct)] bg-gradient-to-r from-cyan-400 to-primary"
          // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (progress bar)
          style={{ '--ds-bar-pct': `${c.pct}%` }}
        />
      </div>
    </>
  )

  if (c.label === 'Total Items') {
    return (
      <div className={`${CELL_CLASS} card-interactive`}>
        <TotalItemsReveal variant="terminal" className="block w-full">
          {inner}
        </TotalItemsReveal>
      </div>
    )
  }
  return (
    <MaybeLink to={c.to} className={c.to ? `${CELL_CLASS} card-interactive block` : CELL_CLASS}>
      {inner}
    </MaybeLink>
  )
}
