import Link from 'next/link'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { getTypeHref } from '@/components/layout/sidebar/utils'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { SkinCollapsibleSection } from './skin-collapsible-section'
import { computeUsage, typeColor, resolveSkinData, type DashboardSkinData } from './shared'

// Editorial (free) — Swiss/typographic: oversized gradient numerals, hairline rules, asymmetric grid.
export async function EditorialSkin(data: DashboardSkinData) {
  const { isPro } = data
  const { stats, collectionStats, collections, pinned, recent, distribution } =
    await resolveSkinData(data)
  const usage = computeUsage(stats.totalItems, isPro)
  const max = Math.max(1, ...distribution.map((d) => d.count))
  const hasRecent = recent.items.length > 0
  const hasPinned = pinned.length > 0

  const figures = [
    { num: stats.totalItems, label: 'Total items', sub: `across ${distribution.filter((d) => d.count > 0).length} types`, href: undefined as string | undefined },
    { num: collectionStats.totalCollections, label: 'Collections', sub: `${collections[0]?.name ?? 'none yet'}`, href: '/collections' },
    { num: stats.favoriteItems, label: 'Favorites', sub: `${stats.favoriteItems} item${stats.favoriteItems === 1 ? '' : 's'} starred`, href: '/favorites' },
  ]

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-7 flex flex-col justify-between gap-7 sm:flex-row sm:items-start">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Developer Knowledge Hub</div>
          <h1 className="mt-3.5 text-4xl font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-5xl">Dashboard</h1>
        </div>
        <dl className="flex min-w-[200px] flex-col gap-2.5 pt-2">
          {[
            ['Free tier', `${stats.totalItems} / ${usage.limit}`],
            ['Collections', String(collectionStats.totalCollections)],
            ['Favorite collections', String(collectionStats.favoriteCollections)],
            ['Status', usage.isPro ? 'Pro' : 'Active'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-border pb-2 text-[13px]">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="h-px bg-border" />

      <div className="my-7 grid grid-cols-1 gap-8 sm:grid-cols-3">
        {figures.map((f) => {
          const inner = (
            <>
              <div className="ds-ed-num text-6xl font-extrabold leading-[0.8] tracking-[-0.05em] sm:text-7xl">
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
              <TotalItemsReveal key={f.label} variant="list" className="flex items-baseline gap-4">
                {inner}
              </TotalItemsReveal>
            )
          }
          if (f.href) {
            return (
              <Link key={f.label} href={f.href} prefetch={false} className="flex items-baseline gap-4 transition-opacity hover:opacity-70">
                {inner}
              </Link>
            )
          }
          return <div key={f.label} className="flex items-baseline gap-4">{inner}</div>
        })}
      </div>

      <div className="h-px bg-border" />

      <div className="mt-7 grid grid-cols-1 gap-10 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <SkinCollapsibleSection
            icon={<span className="font-mono text-xs text-primary">01</span>}
            title="Recent items"
            headerClassName="tracking-[0.1em] text-foreground"
          >
            {hasRecent ? (
              <DashboardRecentItems firstPage={recent} />
            ) : (
              <p className="text-sm text-muted-foreground">No items yet.</p>
            )}
          </SkinCollapsibleSection>
        </section>
        <section>
          <SkinCollapsibleSection
            icon={<span className="font-mono text-xs text-primary">02</span>}
            title="Distribution"
            headerClassName="tracking-[0.1em] text-foreground"
          >
          <div className="flex flex-col gap-1.5">
            {distribution.map((d) => (
              <Link
                key={d.name}
                href={getTypeHref(d.name)}
                prefetch={false}
                className="-mx-2 flex items-center gap-3.5 rounded px-2 py-1.5 text-[13px] transition-colors hover:bg-foreground/5"
              >
                <span className="w-20 capitalize text-muted-foreground">{d.name}</span>
                <span className="relative h-0.5 flex-1 bg-border">
                  <i
                    className="absolute left-0 top-[-2px] h-1.5"
                    style={{ width: `${Math.round((d.count / max) * 100)}%`, background: typeColor(d.name) }}
                  />
                </span>
                <b className="w-6 text-right tabular-nums">{d.count}</b>
              </Link>
            ))}
          </div>
          </SkinCollapsibleSection>
        </section>
      </div>

      {hasPinned && (
        <div className="mt-9">
          <SkinCollapsibleSection
            icon={<span className="font-mono text-xs text-primary">03</span>}
            title="Pinned"
            headerClassName="tracking-[0.1em] text-foreground"
          >
            <DashboardPinnedItems initialItems={pinned} />
          </SkinCollapsibleSection>
        </div>
      )}

      <div className="mt-9">
        <SkinCollapsibleSection
          icon={<span className="font-mono text-xs text-primary">{hasPinned ? '04' : '03'}</span>}
          title="Collections"
          headerClassName="tracking-[0.1em] text-foreground"
        >
          <CollectionsGrid collections={collections} />
        </SkinCollapsibleSection>
      </div>
    </div>
  )
}
