import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { DashboardData } from '@/hooks/use-dashboard'
import { SkinCollectionsGrid } from '@/components/dashboard/skin-collections-grid'
import {
  DashboardPinnedItems,
  DashboardRecentItems,
} from '@/components/dashboard/dashboard-item-lists'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { BrainDumpWidget } from '@/components/dashboard/brain-dump-widget'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { SkinWidget } from './skin-widget'
import { computeUsage, typeColor, TypeLink } from './shared'
import type { SkinLinkTarget } from './shared'

interface EditorialFigure {
  num: number
  label: string
  sub: string
  to?: SkinLinkTarget
}

// Editorial (free) — Swiss/typographic: oversized gradient numerals, hairline rules, asymmetric grid.
export function EditorialSkin({
  isPro,
  totalItems,
  totalCollections,
  distribution,
  collections,
  pinned,
  recent,
}: DashboardData): ReactNode {
  const usage = computeUsage(totalItems, isPro)
  const max = Math.max(1, ...distribution.map((d) => d.count))
  const hasRecent = recent.length > 0
  const hasPinned = pinned.length > 0

  const figures: EditorialFigure[] = [
    {
      num: totalItems,
      label: 'Total items',
      sub: `across ${distribution.filter((d) => d.count > 0).length} types`,
    },
    {
      num: totalCollections,
      label: 'Collections',
      sub: collections[0]?.name ?? 'none yet',
      to: '/collections',
    },
  ]
  const summary: string[][] = [
    ...(isPro ? [] : [['Free tier', `${totalItems} / ${usage.limit}`]]),
    ['Collections', String(totalCollections)],
    ['Status', usage.isPro ? 'Pro' : 'Active'],
  ]

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-7 flex flex-col justify-between gap-7 sm:flex-row sm:items-start">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
            Developer Knowledge Hub
          </div>
          <h1 className="mt-3.5 text-4xl font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-5xl">
            Dashboard
          </h1>
        </div>
        <dl className="hidden min-w-[200px] flex-col gap-2.5 pt-2 sm:flex">
          {summary.map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-border pb-2 text-[13px]">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="h-px bg-border" />

      <div className="my-7 grid grid-cols-2 gap-4 sm:gap-8">
        {isPro && <BrainDumpWidget className="col-span-2" />}
        {figures.map((f) => (
          <EditorialFigureCell key={f.label} figure={f} />
        ))}
      </div>

      <div className="h-px bg-border" />

      <div className="mt-7 grid grid-cols-1 gap-10 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <SkinWidget
            icon={<span className="font-mono text-xs text-primary">01</span>}
            title="Recent items"
            headerClassName="tracking-[0.1em] text-foreground"
          >
            {hasRecent ? (
              <DashboardRecentItems items={recent} />
            ) : (
              <p className="text-sm text-muted-foreground">No items yet.</p>
            )}
          </SkinWidget>
        </section>
        <section>
          <SkinWidget
            icon={<span className="font-mono text-xs text-primary">02</span>}
            title="Distribution"
            headerClassName="tracking-[0.1em] text-foreground"
          >
            <div className="flex flex-col gap-1.5">
              {distribution.map((d) => (
                <TypeLink
                  key={d.name}
                  name={d.name}
                  className="-mx-2 flex items-center gap-3.5 rounded px-2 py-1.5 text-[13px] transition-colors hover:bg-foreground/5"
                >
                  <span className="w-20 capitalize text-muted-foreground">{d.name}</span>
                  <span className="relative h-0.5 flex-1 bg-border">
                    <i
                      className="absolute left-0 top-[-2px] h-1.5 w-[var(--ds-bar-pct)] bg-[var(--ds-bar-color)]"
                      // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom properties (bar)
                      style={{
                        '--ds-bar-pct': `${Math.round((d.count / max) * 100)}%`,
                        '--ds-bar-color': typeColor(d.name),
                      }}
                    />
                  </span>
                  <b className="w-6 text-right tabular-nums">{d.count}</b>
                </TypeLink>
              ))}
            </div>
          </SkinWidget>
        </section>
      </div>

      {hasPinned && (
        <div className="mt-9">
          <SkinWidget
            icon={<span className="font-mono text-xs text-primary">03</span>}
            title="Pinned"
            headerClassName="tracking-[0.1em] text-foreground"
          >
            <DashboardPinnedItems items={pinned} />
          </SkinWidget>
        </div>
      )}

      <div className="mt-9">
        <SkinWidget
          icon={<span className="font-mono text-xs text-primary">{hasPinned ? '04' : '03'}</span>}
          title="Collections"
          headerClassName="tracking-[0.1em] text-foreground"
        >
          <SkinCollectionsGrid collections={collections} />
        </SkinWidget>
      </div>

      {isPro && (
        <div className="mt-9">
          <AiUsageWidget skin="editorial" />
        </div>
      )}
    </div>
  )
}

interface EditorialFigureCellProps {
  figure: EditorialFigure
}

function EditorialFigureCell({ figure: f }: EditorialFigureCellProps): ReactNode {
  const inner = (
    <>
      <div className="ds-ed-num text-5xl font-extrabold leading-[0.8] tracking-[-0.05em] sm:text-7xl">
        {String(f.num).padStart(2, '0')}
      </div>
      <div className="flex flex-col">
        <b className="text-sm font-bold">{f.label}</b>
        <span className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{f.sub}</span>
      </div>
    </>
  )

  if (f.label === 'Total items') {
    return (
      <TotalItemsReveal
        variant="list"
        className="flex items-baseline gap-3 transition-opacity hover:opacity-70 sm:gap-4"
      >
        {inner}
      </TotalItemsReveal>
    )
  }
  if (f.to) {
    return (
      <Link
        to={f.to}
        className="flex items-baseline gap-3 transition-opacity hover:opacity-70 sm:gap-4"
      >
        {inner}
      </Link>
    )
  }
  return <div className="flex items-baseline gap-3 sm:gap-4">{inner}</div>
}
