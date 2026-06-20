import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { CollectionCardSkeleton } from '@/components/shared/skeletons'
import {
  StatsCardsSkeleton,
  CollectionsGridSkeleton,
  PinnedSkeleton,
  RecentItemsSkeleton,
} from '@/components/dashboard/dashboard-skeletons'
import type { UiSkin } from '@/types/editor-preferences'

// Per-skin loading skeletons. Each one reuses the SAME container chrome (grid, gaps, card classes,
// sizes) as its skin's real layout — only the content is replaced with <Skeleton> — so the fallback
// shown inside the dashboard Suspense is pixel-identical to the cards that stream in. Rendered inside
// the [data-skin] wrapper under the skin's auto-applied App Theme, so colors match too.

// ── Shared inner-content skeletons (match the real shared components) ─────────────────────────────

interface HeadProps {
  wide?: boolean
}

function Head({ wide = false }: HeadProps) {
  return (
    <header className="mb-6 space-y-2">
      <Skeleton className="h-4 w-28" />
      <Skeleton className={wide ? 'h-10 w-72' : 'h-8 w-60'} />
      <Skeleton className="h-4 w-48" />
    </header>
  )
}

function SectionLabel() {
  return <Skeleton className="mb-3.5 h-4 w-32" />
}

interface CountSkelProps {
  count?: number
}

// Matches ItemRow (DashboardRecentItems / DashboardPinnedItems): h-[56px] rounded-xl, left accent,
// ring, bg-card, icon + two text lines + trailing meta.
function RowsSkel({ count = 5 }: CountSkelProps) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="app-row h-[56px] gap-3 rounded-xl border-l-2 border-l-border bg-card px-2 ring-1 ring-border">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Skeleton className="hidden h-5 w-12 rounded-full sm:block" />
            <Skeleton className="hidden h-3 w-12 sm:block" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Matches CollectionsGrid (full card grid).
function CollGridSkel({ count = 4 }: CountSkelProps) {
  return (
    <div className="app-grid card-grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => <CollectionCardSkeleton key={i} />)}
    </div>
  )
}

// Matches DashboardCollectionsList (compact single-column rows).
function CollListSkel({ count = 5 }: CountSkelProps) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 px-3 py-2.5">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-3 w-10 shrink-0" />
        </div>
      ))}
    </div>
  )
}

interface BarsSkelProps {
  rows?: number
}

// Matches TypeDistributionBars.
function BarsSkel({ rows = 5 }: BarsSkelProps) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-1.5 py-1">
          <Skeleton className="h-3 w-16 shrink-0" />
          <Skeleton className="h-[7px] flex-1 rounded-full" />
          <Skeleton className="h-3 w-6 shrink-0" />
        </div>
      ))}
    </div>
  )
}

// Matches TypeDistributionSegments (single bar + legend chips).
function SegmentsSkel() {
  return (
    <div>
      <Skeleton className="mb-3 h-7 w-full rounded-md" />
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-5 w-20 rounded-md" />)}
      </div>
    </div>
  )
}

// ── Per-skin skeletons ───────────────────────────────────────────────────────────────────────────

const GLASS = 'ds-glass rounded-2xl'

function AuroraSkeleton() {
  return (
    <>
      <Head />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={`${GLASS} col-span-2 row-span-2 flex flex-col gap-5 p-6`}>
          <div className="flex items-center gap-6">
            <Skeleton className="size-[120px] shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full max-w-[260px]" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
          {/* One bar per item type (7 system types). The hero is row-span-2, so this bar count sets
              the top grid's height — matching the loaded hero keeps the stat tiles the same height. */}
          <BarsSkel rows={7} />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${GLASS} flex flex-col justify-between gap-3 p-5`}>
            <Skeleton className="size-10 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        {/* Left column stacks Collections + Pinned (mirrors the real flex-col). */}
        <div className="flex flex-col gap-4">
          <section className={`${GLASS} p-5`}>
            <SectionLabel />
            <CollGridSkel count={4} />
          </section>
          <section className={`${GLASS} p-5`}>
            <SectionLabel />
            <RowsSkel />
          </section>
        </div>
        {/* Right column: Recent. */}
        <section className={`${GLASS} p-5`}>
          <SectionLabel />
          <RowsSkel />
        </section>
      </div>
    </>
  )
}

function EditorialSkeleton() {
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-7 flex flex-col justify-between gap-7 sm:flex-row sm:items-start">
        <div className="space-y-3.5">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-12 w-64" />
        </div>
        <div className="flex min-w-[200px] flex-col gap-2.5 pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between border-b border-border pb-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-12" />
            </div>
          ))}
        </div>
      </header>
      <div className="h-px bg-border" />
      <div className="my-7 grid grid-cols-1 gap-8 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-baseline gap-4">
            <Skeleton className="h-16 w-16 shrink-0" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-px bg-border" />
      <div className="mt-7 grid grid-cols-1 gap-10 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <Skeleton className="mb-3.5 h-4 w-28" />
          <RowsSkel />
        </section>
        <section>
          <Skeleton className="mb-3.5 h-4 w-28" />
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3.5 px-2 py-1.5">
                <Skeleton className="h-3 w-20 shrink-0" />
                <Skeleton className="h-0.5 flex-1" />
                <Skeleton className="h-3 w-6 shrink-0" />
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="mt-9">
        <Skeleton className="mb-3.5 h-4 w-28" />
        <CollGridSkel count={4} />
      </div>
    </div>
  )
}

// Frosted spatial card chrome (mirrors SP_CARD without the hover transition).
const SP = 'relative overflow-hidden rounded-[28px] border border-foreground/15 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur-2xl'

function SpatialSkeleton() {
  return (
    <>
      <Head />
      <div className="mb-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className={`${SP} flex flex-col justify-center p-8`}>
          <Skeleton className="h-14 w-28" />
          <Skeleton className="mt-2 h-3 w-24" />
          <Skeleton className="mt-5 h-2 w-full rounded-full" />
          <Skeleton className="mt-2.5 h-3 w-40" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${SP} flex flex-col justify-between gap-3 p-5`}>
              <Skeleton className="size-[22px] rounded-md" />
              <div className="space-y-2">
                <Skeleton className="h-7 w-12" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className={`${SP} p-6`}>
          <SectionLabel />
          <CollListSkel />
        </section>
        <section className={`${SP} p-6`}>
          <SectionLabel />
          <RowsSkel />
        </section>
      </div>
    </>
  )
}

const HUD_PANEL = 'rounded-lg border border-border bg-foreground/[0.015] p-5'

function CommandDeckSkeleton() {
  return (
    <div className="font-mono">
      <Head />
      <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-md border border-primary/20 bg-gradient-to-b from-primary/[0.04] to-foreground/[0.015] p-[18px]">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-8 w-14" />
            <Skeleton className="mt-2.5 h-1 w-full rounded-sm" />
            <Skeleton className="mt-1.5 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className={`mb-6 ${HUD_PANEL}`}>
        <SectionLabel />
        <SegmentsSkel />
      </div>
      <div className={`mb-6 ${HUD_PANEL}`}>
        <SectionLabel />
        <CollListSkel />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className={HUD_PANEL}><SectionLabel /><RowsSkel /></div>
        <div className={HUD_PANEL}><SectionLabel /><RowsSkel /></div>
      </div>
    </div>
  )
}

function OrbitalSkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_1fr]">
      {/* Left column: constellation stage + KPI grid beneath it. */}
      <div className="flex flex-col gap-5">
        <div className="relative grid min-h-[460px] place-items-center overflow-hidden rounded-3xl border border-border bg-foreground/[0.02]">
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/[0.05]" />
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/[0.07]" />
          <Skeleton className="size-[130px] rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-foreground/[0.02] p-4">
              <Skeleton className="h-7 w-10" />
              <Skeleton className="mt-1 h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
      {/* Right column: Collections + Recent (Pinned is gated, so omitted). */}
      <div className="flex flex-col gap-5">
        <div className="rounded-2xl border border-border bg-foreground/[0.02] p-5">
          <SectionLabel />
          <CollListSkel />
        </div>
        <div className="rounded-2xl border border-border bg-foreground/[0.02] p-5">
          <SectionLabel />
          <RowsSkel />
        </div>
      </div>
    </div>
  )
}

const MC_PANEL = 'rounded-2xl border border-border bg-foreground/[0.02] p-5'

function MissionControlSkeleton() {
  return (
    <>
      <Head />
      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-foreground/[0.02] p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="my-1.5 h-8 w-16" />
            <Skeleton className="h-1.5 w-full rounded-sm" />
          </div>
        ))}
      </div>
      <div className="mb-4 grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className={MC_PANEL}>
          <SectionLabel />
          <Skeleton className="h-32 w-full rounded-md" />
        </div>
        <div className={MC_PANEL}>
          <SectionLabel />
          <div className="flex justify-center py-2">
            <Skeleton className="size-32 rounded-full" />
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="ml-auto h-3 w-6" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className={MC_PANEL}><SectionLabel /><RowsSkel /></div>
        <div className={MC_PANEL}><SectionLabel /><CollListSkel /></div>
      </div>
    </>
  )
}

const NEON_CELL = 'rounded-lg border border-border bg-[color-mix(in_srgb,var(--card)_60%,transparent)] p-5 backdrop-blur'
const NEON_PANEL = 'rounded-lg border border-primary/30 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] p-5 backdrop-blur'

function NeonGridSkeleton() {
  return (
    <div className="relative min-h-[70vh]">
      <Head wide />
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={NEON_CELL}>
            <Skeleton className="h-8 w-14" />
            <Skeleton className="mt-1.5 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className={NEON_PANEL}><SectionLabel /><RowsSkel /></div>
        <div className={NEON_PANEL}>
          <SectionLabel />
          <CollListSkel />
          <div className="mt-5">
            <SectionLabel />
            <SegmentsSkel />
          </div>
        </div>
      </div>
    </div>
  )
}

interface HoloSkelProps {
  children: ReactNode
  className?: string
}

// Holographic foil card chrome (mirrors HoloCard).
function HoloSkel({ children, className }: HoloSkelProps) {
  return (
    <div className={`ds-holo-foil rounded-[20px] ${className ?? ''}`}>
      <div className="ds-holo-inner rounded-[18.5px] p-[22px]">{children}</div>
    </div>
  )
}

function HolographicSkeleton() {
  return (
    <>
      <Head />
      <div className="mb-5 grid gap-4 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <HoloSkel>
          <Skeleton className="h-12 w-28" />
          <Skeleton className="mt-1 h-3 w-40" />
          <Skeleton className="mt-4 h-[7px] w-full rounded-full" />
        </HoloSkel>
        {Array.from({ length: 3 }).map((_, i) => (
          <HoloSkel key={i}>
            <Skeleton className="h-8 w-12" />
            <Skeleton className="mt-1 h-3 w-20" />
          </HoloSkel>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <HoloSkel><SectionLabel /><RowsSkel /></HoloSkel>
        <HoloSkel><SectionLabel /><CollListSkel /></HoloSkel>
      </div>
    </>
  )
}

// Classic = the dashboard as it ships today: stat chips + the three section cards. Reuses the exact
// classic section skeletons so the fallback matches the loaded classic dashboard.
function ClassicSkeleton() {
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="hidden space-y-2 sm:block">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>
      <StatsCardsSkeleton />
      <CollectionsGridSkeleton />
      <PinnedSkeleton />
      <RecentItemsSkeleton />
    </div>
  )
}

interface DashboardSkinFallbackProps {
  skin: UiSkin
}

export function DashboardSkinFallback({ skin }: DashboardSkinFallbackProps) {
  switch (skin) {
    case 'aurora': return <AuroraSkeleton />
    case 'editorial': return <EditorialSkeleton />
    case 'spatial': return <SpatialSkeleton />
    case 'command-deck': return <CommandDeckSkeleton />
    case 'orbital': return <OrbitalSkeleton />
    case 'mission-control': return <MissionControlSkeleton />
    case 'neon-grid': return <NeonGridSkeleton />
    case 'holographic': return <HolographicSkeleton />
    case 'classic':
    default: return <ClassicSkeleton />
  }
}
