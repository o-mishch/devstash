import type { ReactNode } from 'react'
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
import { OrbitingCircles } from '@/components/ui/orbiting-circles'
import { SkinWidget } from './skin-widget'
import { computeUsage, typeColor, MaybeLink, TypeLink } from './shared'
import type { SkinLinkTarget } from './shared'

const ORBITAL_PANEL =
  'relative overflow-hidden rounded-2xl border border-border bg-foreground/[0.02] p-5 transition-colors duration-300 hover:bg-foreground/[0.04]'

interface OrbitalKpi {
  value: string
  label: string
  to?: SkinLinkTarget
}

// Orbital Core (Pro) — item-type constellation that orbits a glowing core. A single OrbitingCircles
// ring keeps the nodes evenly spaced while they revolve; motion pauses under prefers-reduced-motion.
export function OrbitalSkin({
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

  const kpis: OrbitalKpi[] = [
    ...(isPro ? [] : [{ value: String(usage.slotsLeft), label: 'slots left' }]),
    { value: String(totalCollections), label: 'collections', to: '/collections' },
  ]
  const kpiClass = 'rounded-2xl border border-border bg-foreground/[0.02] px-4 py-2.5'

  return (
    <div>
      {isPro && (
        <div className="mb-3">
          <BrainDumpWidget />
        </div>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-5">
          <div className="relative grid min-h-[460px] place-items-center overflow-hidden rounded-3xl border border-border bg-[radial-gradient(60%_60%_at_50%_50%,color-mix(in_srgb,var(--primary)_16%,transparent),transparent_70%)]">
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 size-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/[0.05]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 size-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/[0.07]"
            />

            <div className="absolute inset-0 flex items-center justify-center motion-reduce:[&_*]:![animation-play-state:paused]">
              <OrbitingCircles radius={130} iconSize={44} duration={36} path>
                {distribution.map((d) => (
                  <OrbitNode key={d.name} name={d.name} count={d.count} />
                ))}
              </OrbitingCircles>
            </div>

            <div className="ds-orb-core relative z-10 grid size-[130px] place-items-center rounded-full border border-foreground/15 text-center">
              <div>
                <b className="block text-4xl font-extrabold">{totalItems}</b>
                <span className="text-[11px] text-muted-foreground">items</span>
              </div>
            </div>

            <div className="absolute bottom-4 left-0 right-0 text-center font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
              Type constellation · live
            </div>
          </div>

          <div className={`grid grid-cols-2 gap-3 ${isPro ? '[&>*:last-child]:col-span-2' : ''}`}>
            {kpis.map((k) => (
              <MaybeLink
                key={k.label}
                to={k.to}
                className={k.to ? `${kpiClass} transition-colors hover:bg-foreground/5` : kpiClass}
              >
                <div className="text-2xl font-extrabold">{k.value}</div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">{k.label}</div>
              </MaybeLink>
            ))}
          </div>

          <div className={`${ORBITAL_PANEL} flex-1`}>
            <SkinWidget icon={<History />} title="Recent" skin="orbital">
              {hasRecent ? (
                <DashboardRecentItems items={recent} />
              ) : (
                <p className="text-sm text-muted-foreground">No items yet.</p>
              )}
            </SkinWidget>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          {hasPinned && (
            <div className={ORBITAL_PANEL}>
              <SkinWidget icon={<Pin />} title="Pinned" skin="orbital">
                <DashboardPinnedItems items={pinned} />
              </SkinWidget>
            </div>
          )}
          <div className={ORBITAL_PANEL}>
            <SkinWidget
              icon={<Folder />}
              title="Collections"
              count={totalCollections}
              skin="orbital"
            >
              <DashboardCollectionsList collections={collections} />
            </SkinWidget>
          </div>
        </div>
      </div>

      {isPro && (
        <div className={`${ORBITAL_PANEL} mt-6`}>
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

function OrbitNode({ name, count }: OrbitNodeProps): ReactNode {
  const color = typeColor(name)
  const muted = count === 0
  return (
    <TypeLink name={name} className="flex flex-col items-center gap-1">
      <span
        className="ds-orbit-node grid size-[42px] place-items-center rounded-full text-sm font-extrabold text-white"
        data-muted={muted || undefined}
        // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (node accent color)
        style={{ '--ds-orbit-color': color }}
      >
        {count}
      </span>
      <span
        className={cn(
          'whitespace-nowrap text-[11px] capitalize text-muted-foreground',
          muted && 'opacity-50',
        )}
      >
        {name}
      </span>
    </TypeLink>
  )
}
