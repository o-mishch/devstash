import Link from 'next/link'
import { History, Folder, Pin } from 'lucide-react'
import { getTypeHref } from '@/components/layout/sidebar/utils'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { BrainDumpWidget } from '@/components/dashboard/brain-dump-widget'
import { OrbitingCircles } from '@/components/ui/orbiting-circles'
import { SkinWidget } from './skin-widget'
import { computeUsage, typeColor, resolveSkinData, MaybeLink, type DashboardSkinData } from './shared'

// Orbital Core (Pro) — item-type constellation that genuinely orbits a glowing core. A single
// OrbitingCircles ring keeps the nodes evenly spaced (no clustering) while they revolve; the
// component counter-rotates each node so its badge/label stay upright. Radius is kept inside the
// stage so nothing clips. Motion is paused under prefers-reduced-motion (motion-safe gate below).
export async function OrbitalSkin(data: DashboardSkinData) {
  const { isPro } = data
  const { stats, collectionStats, collections, pinned, recent, distribution } =
    await resolveSkinData(data)
  const usage = computeUsage(stats.totalItems, isPro)
  const hasRecent = recent.items.length > 0
  const hasPinned = pinned.length > 0

  // Favorites + fav. collections are reachable from the header/sidebar star and Collections nav, so
  // those vanity KPIs are dropped. The constellation core already shows the total, leaving Collections
  // as the one useful secondary count (it spans full width below the stage). Free keeps slots-left.
  const kpis = [
    ...(isPro
      ? []
      : [{ value: String(usage.slotsLeft), label: 'slots left', href: undefined as string | undefined }]),
    { value: String(collectionStats.totalCollections), label: 'collections', href: '/collections' as string | undefined },
  ]
  const kpiClass = 'rounded-2xl border border-border bg-foreground/[0.02] px-4 py-2.5'

  return (
    <div>
    {isPro && (
      <div className="mb-3">
        <BrainDumpWidget skin="orbital" />
      </div>
    )}
    <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_1fr] [&>*]:min-w-0">
      {/* Left column: the constellation stage with the KPI cards stacked beneath it.
          items-start (not stretch) keeps the stage at its own min-h-[460px] height instead of
          being stretched to the right column's full height (which shoved the planets far down). */}
      <div className="flex flex-col gap-5">
        <div className="relative grid min-h-[460px] place-items-center overflow-hidden rounded-3xl border border-border bg-[radial-gradient(60%_60%_at_50%_50%,color-mix(in_srgb,var(--primary)_16%,transparent),transparent_70%)]">
          {/* decorative concentric rings */}
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/[0.05]" />
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/[0.07]" />

          {/* orbiting type nodes — single ring, evenly spaced, animated. The flex-center wrapper is
              required so OrbitingCircles' absolutely-positioned nodes pivot around the stage center
              (where the core sits), not the top-left corner. */}
          <div className="absolute inset-0 flex items-center justify-center motion-reduce:[&_*]:![animation-play-state:paused]">
            <OrbitingCircles radius={130} iconSize={44} duration={36} path>
              {distribution.map((d) => (
                <OrbitNode key={d.name} name={d.name} count={d.count} />
              ))}
            </OrbitingCircles>
          </div>

          {/* core */}
          <div className="ds-orb-core relative z-10 grid size-[130px] place-items-center rounded-full border border-foreground/15 text-center">
            <div>
              <b className="block text-4xl font-extrabold">{stats.totalItems}</b>
              <span className="text-[11px] text-muted-foreground">items</span>
            </div>
          </div>

          <div className="absolute bottom-4 left-0 right-0 text-center font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
            Type constellation · live
          </div>
        </div>

        <div className={`grid grid-cols-2 gap-3 ${isPro ? '[&>*:last-child]:col-span-2' : ''}`}>
          {kpis.map((k) => {
            const inner = (
              <>
                <div className="text-2xl font-extrabold">{k.value}</div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">{k.label}</div>
              </>
            )
            return (
              <MaybeLink key={k.label} href={k.href} className={k.href ? `${kpiClass} transition-colors hover:bg-foreground/5` : kpiClass}>{inner}</MaybeLink>
            )
          })}
        </div>

        <div className="flex-1 relative overflow-hidden rounded-2xl border border-border bg-foreground/[0.02] p-5">
          <SkinWidget icon={<History />} title="Recent" skin="orbital">
            {hasRecent ? <DashboardRecentItems firstPage={recent} /> : <p className="text-sm text-muted-foreground">No items yet.</p>}
          </SkinWidget>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {hasPinned && (
          <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground/[0.02] p-5">
            <SkinWidget icon={<Pin />} title="Pinned" skin="orbital">
              <DashboardPinnedItems initialItems={pinned} />
            </SkinWidget>
          </div>
        )}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground/[0.02] p-5">
          <SkinWidget icon={<Folder />} title="Collections" count={collectionStats.totalCollections} skin="orbital">
            <DashboardCollectionsList collections={collections} />
          </SkinWidget>
        </div>
      </div>
    </div>

      {/* AI Usage — demoted to the foot of the dashboard: occasional-reassurance data, below content. */}
      {isPro && (
        <div className="mt-6 relative overflow-hidden rounded-2xl border border-border bg-foreground/[0.02] p-5">
          <AiUsageWidget skin="orbital" />
        </div>
      )}
    </div>
  )
}

interface OrbitNodeProps {
  name: string
  count: number
}

function OrbitNode({ name, count }: OrbitNodeProps) {
  const color = typeColor(name)
  const muted = count === 0
  return (
    <Link href={getTypeHref(name)} prefetch={false} className="flex flex-col items-center gap-1">
      <span
        className="grid size-[42px] place-items-center rounded-full text-sm font-extrabold text-white"
        style={{
          background: `color-mix(in srgb, ${color} 28%, var(--card))`,
          border: `1.5px solid ${color}`,
          boxShadow: muted ? 'none' : `0 0 22px -6px ${color}`,
          opacity: muted ? 0.45 : 1,
        }}
      >
        {count}
      </span>
      <span className="whitespace-nowrap text-[11px] capitalize text-muted-foreground" style={{ opacity: muted ? 0.5 : 1 }}>
        {name}
      </span>
    </Link>
  )
}
