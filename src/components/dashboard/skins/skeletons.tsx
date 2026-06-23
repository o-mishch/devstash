import type { ReactNode } from 'react'
import { ChevronDown, Gauge } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CollectionCardSkeleton } from '@/components/shared/skeletons'
import {
  StatsCardsSkeleton,
  CollectionsGridSkeleton,
  PinnedSkeleton,
  RecentItemsSkeleton,
} from '@/components/dashboard/dashboard-skeletons'
import { brainDumpSkinPanel } from '@/components/dashboard/skins/brain-dump-skin-panel'
import { aiUsageSkinTreatment } from '@/components/dashboard/skins/ai-usage-treatment'
import { cn } from '@/lib/utils'
import type { UiSkin } from '@/types/editor-preferences'

// Per-skin loading skeletons. Each one reuses the SAME container chrome (grid, gaps, card classes,
// sizes) as its skin's real layout — only the content is replaced with <Skeleton> — so the fallback
// shown inside the dashboard Suspense is pixel-identical to the cards that stream in. Rendered inside
// the [data-skin] wrapper under the skin's auto-applied App Theme, so colors match too.
//
// `isPro` mirrors the per-skin Pro/free layout split: Pro users drop the dead "∞ / slots-left" stat
// tile (the stat row reflows) and gain the AI Usage section at the foot; free users keep the tile and
// have no AI section. The six Pro-only skins always render their Pro layout (they never load for a
// free user — page.tsx downgrades a stored Pro skin to classic), so only the three free skins
// (classic / aurora / editorial) branch on the flag.

// ── Shared inner-content skeletons (match the real shared components) ─────────────────────────────

interface HeadProps {
  wide?: boolean
}

function Head({ wide = false }: HeadProps) {
  return (
    <header className="mb-6">
      <Skeleton className="h-4 w-28" />
      <Skeleton className={cn('mt-1', wide ? 'h-10 w-72' : 'h-8 w-60')} />
      <Skeleton className="mt-1 h-4 w-48" />
    </header>
  )
}

interface TextSkelProps {
  // Text utility classes to mirror — the SAME ones the loaded element uses. The wrapper inherits the
  // real CSS line-height (and, with a width class, the real box), so the skeleton occupies an identical
  // box at every root-font scale (110% touch / 125% desktop) where a fixed h-* bar would drift. The
  // bar is absolute so it never affects the wrapper's height. See context/fixes/skeleton-positioning-
  // alignment.md (Round 2).
  className?: string
  // Vertical thickness of the bar within the line box (cosmetic only — doesn't affect layout).
  inset?: string
  // Invisible glyphs that hold the line-height; when no width class is given they also size the wrapper
  // (use the real text's char count, e.g. "00" for a 2-digit figure).
  placeholder?: string
}

// A skeleton bar that occupies the exact line-box of the text it stands in for. Prefer this over a bare
// <Skeleton className="h-..."> for any text the card's height depends on.
function TextSkel({ className, inset = 'inset-y-[18%]', placeholder = ' ' }: TextSkelProps) {
  return (
    <div className={cn('relative', className)}>
      <span className="invisible select-none">{placeholder}</span>
      <Skeleton className={cn('absolute inset-x-0 rounded-sm', inset)} />
    </div>
  )
}

interface SectionLabelProps {
  count?: boolean
}

// Matches the SkinWidget header row that every non-classic skin renders: a primary icon
// on the left, the uppercase label, an optional count badge, and a chevron pushed to the right
// (ml-auto). mb-3.5 mirrors the real header→content gap (CollapsibleContent pt-3.5).
function SectionLabel({ count = false }: SectionLabelProps) {
  return (
    <div className="mb-3.5 flex w-full items-center gap-2.5">
      <Skeleton className="size-[15px] shrink-0 rounded-sm" />
      <Skeleton className="h-3.5 w-28" />
      {count && <Skeleton className="h-5 w-7 rounded-full" />}
      <Skeleton className="ml-auto size-4 shrink-0 rounded-sm" />
    </div>
  )
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

// ── AI Usage section skeleton (matches AiUsageWidget) ─────────────────────────────────────────────

interface AiUsageSkelProps {
  skin: UiSkin
}

// Mirrors AiUsageWidget for the non-classic skins: a SkinWidget header (icon + "AI Usage" + chevron =
// SectionLabel) over the @container 2-up/@md:4-up grid of compact meter cards (icon + label/value line
// + slim bar = UsageMeterSkeleton). The skin's own panel chrome is supplied by the caller, exactly as
// each skin wraps <AiUsageWidget /> in its panel.
function AiUsageSkel({ skin }: AiUsageSkelProps) {
  const treatment = aiUsageSkinTreatment(skin)
  return (
    <div className="@container">
      <SectionLabel />
      <div className="grid grid-cols-2 gap-2.5 @md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2', treatment.card)}>
            <Skeleton className="size-4 shrink-0 rounded" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="mt-1.5 h-1 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Classic AI Usage section — the Card-based DashboardWidget chrome (not SkinWidget). Title text is
// rendered literally to match the other classic section skeletons (which show real titles).
function ClassicAiUsageSkel() {
  return (
    <div className="@container">
      <Card className="bg-[var(--muted,var(--background))] border-l-2 border-l-accent">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
            <Gauge className="size-3.5 text-primary" />
            AI Usage
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="grid grid-cols-2 gap-2.5 @md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-lg border border-border bg-foreground/[0.02] px-3 py-2">
                <Skeleton className="size-4 shrink-0 rounded" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="mt-1.5 h-1 w-full rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Brain Dump banner skeleton (matches BrainDumpWidget) ──────────────────────────────────────────

interface BrainDumpSkelProps {
  // The skin's panel chrome (same constant the skin wraps its sections in) so the banner placeholder
  // matches the loaded BrainDumpWidget's chrome. `sheen` mirrors spatial/holographic inner overlays.
  panel: string
  sheen?: string
  // Span/layout class for placing the placeholder as a cell inside a KPI-row grid (e.g. col-span-2).
  className?: string
}

// Mirrors BrainDumpWidget's new two-row stacked layout: row 1 = icon tile + title + subtitle, row 2 =
// quota meter bar + CTA button. Same compact padding (px-3.5 py-2.5) as the real widget so the cell
// matches when it streams in.
function BrainDumpSkel({ panel, sheen, className }: BrainDumpSkelProps) {
  return (
    <div className={cn('flex h-full flex-col justify-center gap-2.5 px-3.5 py-2.5', panel, className)}>
      {sheen && <div className={sheen} />}
      <div className="relative flex min-w-0 items-center gap-2.5">
        <Skeleton className="size-8 shrink-0 rounded-[10px]" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-40 max-lg:hidden" />
      </div>
      <div className="relative flex items-center gap-3">
        <Skeleton className="h-2 flex-1 rounded-full" />
        {/* Arrow-tile affordance — the whole card is the action, so no full-width CTA placeholder. */}
        <Skeleton className="size-7 shrink-0 rounded-lg" />
      </div>
    </div>
  )
}

// ── Per-skin skeletons ───────────────────────────────────────────────────────────────────────────

const GLASS = 'ds-glass rounded-2xl'

interface SkinSkeletonProps {
  isPro: boolean
}

function AuroraSkeleton({ isPro }: SkinSkeletonProps) {
  // Pro drops the slots-left tile, so only Collections remains and the hero sits beside it (2-up).
  // Free keeps both tiles; the hero spans the full row above them.
  const tileCount = isPro ? 1 : 2
  return (
    <div className="relative">
      <div className="relative">
        <Head />
        <div className={cn('mb-6 grid grid-cols-2 gap-4', isPro ? 'lg:grid-cols-4' : 'lg:grid-cols-2')}>
          {/* Height is driven by the fixed 64px ring (the text block stays shorter), matching the real hero. */}
          <div className={cn(`${GLASS} flex items-center gap-4 px-5 py-3`, !isPro && 'col-span-2 lg:col-span-2')}>
            <Skeleton className="size-[64px] shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <TextSkel className="w-44 text-sm font-bold sm:text-base" inset="inset-y-[18%]" />
              <TextSkel className="mt-1 hidden w-full max-w-[280px] text-[13px] leading-snug sm:block" inset="inset-y-[15%]" />
            </div>
          </div>
          {Array.from({ length: tileCount }).map((_, i) => (
            <div
              key={i}
              className={cn(
                GLASS,
                isPro
                  ? 'flex items-center justify-center gap-3 px-5 py-3 text-center'
                  : 'flex items-center gap-3 px-4 py-3',
              )}
            >
              <Skeleton className="size-9 shrink-0 rounded-xl" />
              <Skeleton className="h-6 w-10" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
          {isPro && <BrainDumpSkel {...brainDumpSkinPanel('aurora')} className="col-span-2" />}
        </div>
        {/* Type distribution — its own full-width card below the hero/stat row. */}
        <div className={`${GLASS} mb-6 p-5`}>
          <BarsSkel rows={7} />
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
          {/* Left column stacks Collections + Pinned (mirrors the real flex-col). */}
          <div className="flex flex-col gap-4">
            <section className={`${GLASS} p-5`}>
              <SectionLabel count />
              <CollGridSkel count={6} />
            </section>
            <section className={`${GLASS} p-5`}>
              <SectionLabel />
              <RowsSkel count={5} />
            </section>
          </div>
          {/* Right column: Recent. */}
          <section className={`${GLASS} p-5`}>
            <SectionLabel />
            <RowsSkel count={7} />
          </section>
        </div>
        {isPro && (
          <div className={`${GLASS} mt-6 p-5`}>
            <AiUsageSkel skin="aurora" />
          </div>
        )}
      </div>
    </div>
  )
}

function EditorialSkeleton({ isPro }: SkinSkeletonProps) {
  // Favorites figure is dropped for all users (2 figures: Total + Collections). The side summary
  // drops the "Free tier" row for Pro (2 rows vs 3).
  const summaryRows = isPro ? 2 : 3
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-7 flex flex-col justify-between gap-7 sm:flex-row sm:items-start">
        <div>
          <TextSkel className="w-48 text-xs font-semibold uppercase tracking-[0.22em]" inset="inset-y-[15%]" />
          <TextSkel className="mt-3.5 w-56 text-4xl font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-5xl" inset="inset-y-[20%]" />
        </div>
        <dl className="hidden min-w-[200px] flex-col gap-2.5 pt-2 sm:flex">
          {Array.from({ length: summaryRows }).map((_, i) => (
            <div key={i} className="flex justify-between border-b border-border pb-2 text-[13px]">
              <TextSkel className="w-20" inset="inset-y-[20%]" />
              <TextSkel className="w-12" inset="inset-y-[20%]" />
            </div>
          ))}
        </dl>
      </header>
      <div className="h-px bg-border" />
      <div className="my-7 grid grid-cols-2 gap-4 sm:gap-8">
        {isPro && <BrainDumpSkel {...brainDumpSkinPanel('editorial')} className="col-span-2" />}
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-baseline gap-3 sm:gap-4">
            <TextSkel
              className="shrink-0 text-5xl font-extrabold leading-[0.8] tracking-[-0.05em] sm:text-7xl"
              inset="inset-y-[10%]"
              placeholder="00"
            />
            <div className="flex flex-col">
              <TextSkel className="w-20 text-sm font-bold" inset="inset-y-[18%]" />
              <TextSkel className="mt-0.5 w-24 text-[12.5px]" inset="inset-y-[15%]" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-px bg-border" />
      <div className="mt-7 grid grid-cols-1 gap-10 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <SectionLabel />
          <RowsSkel count={7} />
        </section>
        <section>
          <SectionLabel />
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="-mx-2 flex items-center gap-3.5 px-2 py-1.5 text-[13px]">
                <TextSkel className="w-20" inset="inset-y-[20%]" />
                <span className="h-0.5 flex-1 bg-border" />
                <TextSkel className="w-6" inset="inset-y-[20%]" />
              </div>
            ))}
          </div>
        </section>
      </div>
      {/* Pinned section */}
      <div className="mt-9">
        <SectionLabel />
        <RowsSkel count={5} />
      </div>
      <div className="mt-9">
        <SectionLabel />
        <CollGridSkel count={6} />
      </div>
      {isPro && (
        <div className="mt-9">
          <AiUsageSkel skin="editorial" />
        </div>
      )}
    </div>
  )
}

// Frosted spatial card chrome (mirrors SP_CARD without the hover transition).
const SP = 'relative overflow-hidden rounded-[28px] border border-foreground/15 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur-2xl'

function SpatialSkeleton() {
  return (
    <div>
      <header className="mb-7">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="mt-1 h-8 w-60" />
      </header>
      <div className="mb-5 grid grid-cols-[1.3fr_1fr] gap-3 sm:gap-5 lg:grid-cols-[1fr_0.9fr_1.6fr]">
        <div className={`${SP} flex items-center gap-3 px-4 py-3 sm:gap-5 sm:px-5`}>
          {/* number text-3xl leading-none + mt-1 + label text-sm — mirrored so the block height tracks
              the real text at every root-font scale (a fixed h-* would drift on the 125% desktop root). */}
          <div className="shrink-0">
            <TextSkel className="w-8 text-3xl font-extrabold leading-none" inset="inset-y-[12%]" />
            <TextSkel className="mt-1 w-16 text-sm" inset="inset-y-[18%]" />
          </div>
          <div className="min-w-0 flex-1">
            <Skeleton className="h-2 w-full rounded-full" />
            <TextSkel className="mt-2 w-20 text-xs" inset="inset-y-[20%]" />
          </div>
        </div>
        {/* Pro: a single one-line Collections mini spans the full width of the 2-col grid, centered. */}
        <div className="grid grid-cols-2 gap-4 [&>*:last-child]:col-span-2">
          <div className={`${SP} flex items-center justify-center gap-3 px-5 py-3 text-center`}>
            <Skeleton className="size-[22px] rounded-md" />
            <div className="flex items-baseline gap-2">
              <TextSkel className="w-6 text-2xl font-extrabold leading-none" inset="inset-y-[12%]" />
              <TextSkel className="w-14 text-xs" inset="inset-y-[20%]" />
            </div>
          </div>
        </div>
        <BrainDumpSkel {...brainDumpSkinPanel('spatial')} className="col-span-2 lg:col-span-1" />
      </div>
      {/* Pinned section */}
      <section className={`${SP} mb-5 p-6`}>
        <SectionLabel />
        <RowsSkel count={5} />
      </section>
      <div className="grid items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <section className={`${SP} p-6`}>
          <SectionLabel />
          <CollListSkel />
        </section>
        <section className={`${SP} p-6`}>
          <SectionLabel />
          <RowsSkel count={7} />
        </section>
      </div>
      <section className={`${SP} mt-5 p-6`}>
        <AiUsageSkel skin="spatial" />
      </section>
    </div>
  )
}

const HUD_PANEL = 'rounded-lg border border-border bg-foreground/[0.015] p-5'
const CD_CELL = 'rounded-md border border-primary/20 bg-gradient-to-b from-primary/[0.04] to-foreground/[0.015] px-[18px] py-3'

function CommandDeckSkeleton() {
  return (
    <div className="relative overflow-hidden">
      <div className="relative font-mono">
        {/* Mono HUD header (// SYSTEM ONLINE · dashboard · sub) — not the generic Head. */}
        <header className="mb-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-1 h-8 w-44" />
          <Skeleton className="mt-1 h-4 w-60" />
        </header>
        {/* Pro: clean 2-up readout cells (Total + Collections) beside a wide 2-col Brain Dump cell on a
            4-col track; the slots-left cell is dropped. */}
        <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className={CD_CELL}>
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="mt-1 h-6 w-12" />
                </div>
                <Skeleton className="h-2.5 w-16" />
              </div>
              <Skeleton className="mt-2 h-1 w-full rounded-sm" />
            </div>
          ))}
          <BrainDumpSkel {...brainDumpSkinPanel('command-deck')} className="col-span-2" />
        </div>
        <div className={`mb-6 ${HUD_PANEL}`}>
          <SectionLabel count />
          <CollListSkel />
        </div>
        <div className="mb-6 grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <div className={HUD_PANEL}><SectionLabel /><RowsSkel count={5} /></div>
          <div className={HUD_PANEL}><SectionLabel /><RowsSkel count={7} /></div>
        </div>
        <div className={`mb-6 ${HUD_PANEL}`}>
          <SectionLabel />
          <SegmentsSkel />
        </div>
        <div className={`mt-6 ${HUD_PANEL}`}>
          <AiUsageSkel skin="command-deck" />
        </div>
      </div>
    </div>
  )
}

const ORBITAL_PANEL = 'rounded-2xl border border-border bg-foreground/[0.02] p-5'

function OrbitalSkeleton() {
  return (
    <div>
      <div className="mb-3">
        <BrainDumpSkel {...brainDumpSkinPanel('orbital')} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_1fr] [&>*]:min-w-0">
        {/* Left column: constellation stage, KPI grid, then Recent beneath it. */}
        <div className="flex flex-col gap-5">
          <div className="relative grid min-h-[460px] place-items-center overflow-hidden rounded-3xl border border-border bg-foreground/[0.02]">
            <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/[0.05]" />
            <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/[0.07]" />
            <Skeleton className="size-[130px] rounded-full" />
          </div>
          {/* Pro: a single Collections KPI spanning the full 2-col width. */}
          <div className="grid grid-cols-2 gap-3 [&>*:last-child]:col-span-2">
            <div className="rounded-2xl border border-border bg-foreground/[0.02] px-4 py-2.5">
              <Skeleton className="h-7 w-10" />
              <Skeleton className="mt-0.5 h-3 w-16" />
            </div>
          </div>
          <div className={`flex-1 ${ORBITAL_PANEL}`}>
            <SectionLabel />
            <RowsSkel count={7} />
          </div>
        </div>
        {/* Right column: Pinned + Collections. */}
        <div className="flex flex-col gap-5">
          <div className={ORBITAL_PANEL}>
            <SectionLabel />
            <RowsSkel count={5} />
          </div>
          <div className={ORBITAL_PANEL}>
            <SectionLabel count />
            <CollListSkel />
          </div>
        </div>
      </div>
      <div className={`mt-6 ${ORBITAL_PANEL}`}>
        <AiUsageSkel skin="orbital" />
      </div>
    </div>
  )
}

const MC_PANEL = 'rounded-2xl border border-border bg-foreground/[0.02] p-5'

function MissionControlSkeleton() {
  return (
    <div>
      <header className="mb-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-1 h-8 w-44" />
      </header>
      {/* Pro: 2-up KPIs (Total w/ sparkline + Collections) beside a wide 2-col Brain Dump cell on a
          4-col track; the free-tier tile is dropped. */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-foreground/[0.02] px-4 py-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="size-3 rounded" />
          </div>
          <Skeleton className="mt-1 h-6 w-16" />
          <Skeleton className="mt-2 h-8 w-full rounded" />
        </div>
        <div className="rounded-2xl border border-border bg-foreground/[0.02] px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="mt-1 h-6 w-12" />
        </div>
        <BrainDumpSkel {...brainDumpSkinPanel('mission-control')} className="col-span-2" />
      </div>
      {/* Pinned section */}
      <div className={`${MC_PANEL} mb-4`}>
        <SectionLabel />
        <RowsSkel count={5} />
      </div>
      {/* Day-to-day content first (Recent + Collections), analytics below. */}
      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className={MC_PANEL}><SectionLabel /><RowsSkel count={7} /></div>
        <div className={MC_PANEL}><SectionLabel count /><CollListSkel /></div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <div className={MC_PANEL}>
          <SectionLabel />
          <Skeleton className="h-32 w-full rounded-md" />
        </div>
        <div className={MC_PANEL}>
          <SectionLabel />
          <div className="flex justify-center py-2">
            <Skeleton className="size-32 rounded-full" />
          </div>
          <div className="mt-4 flex flex-col gap-0.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="ml-auto h-3 w-6" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={`mt-4 ${MC_PANEL}`}>
        <AiUsageSkel skin="mission-control" />
      </div>
    </div>
  )
}

const NEON_CELL = 'rounded-lg border border-border bg-[color-mix(in_srgb,var(--card)_60%,transparent)] px-4 py-3 backdrop-blur'
const NEON_PANEL = 'rounded-lg border border-primary/30 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] p-5 backdrop-blur'

function NeonGridSkeleton() {
  return (
    <div className="relative min-h-[70vh]">
      <div className="relative z-10">
        <Head wide />
        {/* Pro: 2-up cells (Total + Collections) beside a wide 2-col Brain Dump cell on a 4-col track;
            the slots-left cell is dropped. */}
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className={NEON_CELL}>
              <Skeleton className="h-6 w-14" />
              <Skeleton className="mt-1.5 h-3 w-20" />
            </div>
          ))}
          <BrainDumpSkel {...brainDumpSkinPanel('neon-grid')} className="col-span-2" />
        </div>
        {/* Pinned section */}
        <div className={`${NEON_PANEL} mb-4`}>
          <SectionLabel />
          <RowsSkel count={5} />
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className={NEON_PANEL}><SectionLabel /><RowsSkel count={7} /></div>
          <div className={NEON_PANEL}>
            <SectionLabel />
            <CollListSkel />
            <div className="mt-5">
              <SectionLabel />
              <SegmentsSkel />
            </div>
          </div>
        </div>
        <div className={`mt-6 ${NEON_PANEL}`}>
          <AiUsageSkel skin="neon-grid" />
        </div>
      </div>
    </div>
  )
}

interface HoloSkelProps {
  children: ReactNode
  className?: string
  innerClassName?: string
}

// Holographic foil card chrome (mirrors HoloCard).
function HoloSkel({ children, className, innerClassName }: HoloSkelProps) {
  return (
    <div className={`ds-holo-foil rounded-[20px] ${className ?? ''}`}>
      <div className={`ds-holo-inner rounded-[18.5px] ${innerClassName ?? 'p-[22px]'}`}>{children}</div>
    </div>
  )
}

function HolographicSkeleton() {
  return (
    <div>
      <header className="mb-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-1 h-8 w-60" />
      </header>
      {/* Slim hero (number + bar in one row) + a one-line Collections card + a wide Brain Dump cell. */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-[1.4fr_1fr_1.6fr]">
        <HoloSkel className="relative overflow-hidden" innerClassName="px-4 py-3 sm:px-5">
          {/* number text-3xl leading-none + mt-1 + label text-[13px] — mirrored for scale-correct height. */}
          <div className="flex h-full items-center gap-3 sm:gap-5">
            <div className="shrink-0">
              <TextSkel className="w-8 text-3xl font-extrabold leading-none" inset="inset-y-[12%]" />
              <TextSkel className="mt-1 w-16 text-[13px]" inset="inset-y-[18%]" />
            </div>
            <div className="min-w-0 flex-1">
              <Skeleton className="h-[7px] w-full rounded-full" />
              <TextSkel className="mt-2 w-20 text-[13px]" inset="inset-y-[18%]" />
            </div>
          </div>
        </HoloSkel>
        <HoloSkel innerClassName="px-4 py-3 sm:px-5">
          <div className="flex h-full items-baseline gap-2">
            <TextSkel className="w-6 text-3xl font-extrabold leading-none" inset="inset-y-[12%]" />
            <TextSkel className="w-14 text-[12.5px]" inset="inset-y-[18%]" />
          </div>
        </HoloSkel>
        <BrainDumpSkel {...brainDumpSkinPanel('holographic')} />
      </div>
      {/* Pinned section */}
      <div className="mb-4">
        <HoloSkel>
          <SectionLabel />
          <RowsSkel count={5} />
        </HoloSkel>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <HoloSkel className="relative overflow-hidden"><SectionLabel /><RowsSkel count={7} /></HoloSkel>
        <HoloSkel><SectionLabel count /><CollListSkel /></HoloSkel>
      </div>
      <div className="mt-4">
        <HoloSkel><AiUsageSkel skin="holographic" /></HoloSkel>
      </div>
    </div>
  )
}

// Classic = the dashboard as it ships today: stat chips + the three section cards (+ the AI Usage
// section for Pro). Reuses the exact classic section skeletons so the fallback matches the loaded
// classic dashboard.
function ClassicSkeleton({ isPro }: SkinSkeletonProps) {
  return (
    <>
      <div className="hidden sm:block">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-1 h-4 w-56" />
      </div>
      <StatsCardsSkeleton isPro={isPro} />
      <CollectionsGridSkeleton />
      <PinnedSkeleton />
      <RecentItemsSkeleton />
      {isPro && <ClassicAiUsageSkel />}
    </>
  )
}

interface DashboardSkinFallbackProps {
  skin: UiSkin
  isPro: boolean
}

export function DashboardSkinFallback({ skin, isPro }: DashboardSkinFallbackProps) {
  switch (skin) {
    case 'aurora': return <AuroraSkeleton isPro={isPro} />
    case 'editorial': return <EditorialSkeleton isPro={isPro} />
    case 'spatial': return <SpatialSkeleton />
    case 'command-deck': return <CommandDeckSkeleton />
    case 'orbital': return <OrbitalSkeleton />
    case 'mission-control': return <MissionControlSkeleton />
    case 'neon-grid': return <NeonGridSkeleton />
    case 'holographic': return <HolographicSkeleton />
    case 'classic':
    default: return <ClassicSkeleton isPro={isPro} />
  }
}
