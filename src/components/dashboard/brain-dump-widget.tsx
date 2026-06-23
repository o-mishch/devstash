'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Sparkles, ArrowRight, RotateCw, Clock } from 'lucide-react'
import type { UiSkin } from '@/types/ui-skins'
import { NumberTicker } from '@/components/ui/number-ticker'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useAiUsage } from '@/hooks/use-ai-usage'
import { useActiveBrainDumpJobs, BRAIN_DUMP_STATUS_LABEL } from '@/hooks/use-brain-dump'
import { formatRenewIn } from '@/lib/utils/format'
import { cn } from '@/lib/utils'

// Per-skin chrome for the Brain Dump banner — the wrapper card classes + the inner accent treatment,
// mirroring how each skin wraps its own sections (see ai-usage-widget SKIN_TREATMENTS and the skin
// files' panel constants). Each entry is the full-width panel a skin places at the very top.
interface SkinChrome {
  // The outer panel classes (border/background/radius/blur) — matches the skin's section chrome.
  panel: string
  // Optional inner sheen/overlay element rendered absolutely behind the content (spatial/holographic).
  sheen?: string
  // The accent bar fill for the quota meter.
  bar: string
  // Extra trigger/heading classes (e.g. mono for command-deck / neon-grid).
  font?: string
}

const DEFAULT_CHROME: SkinChrome = {
  // Matches the classic stat chips' left-accent treatment so Brain Dump reads as one of the row: a
  // 2px left border in the primary accent, dimmed at rest and brightening to full color on hover/press
  // (the chips use --stat-accent; here the accent is the primary). `card-interactive` supplies the lift.
  panel:
    'rounded-xl border border-l-2 border-border border-l-[color-mix(in_oklab,var(--primary),transparent_55%)] bg-card hover:border-l-primary active:border-l-primary',
  bar: 'bg-primary',
}

const SKIN_CHROME: Partial<Record<UiSkin, SkinChrome>> = {
  aurora: { panel: 'ds-glass rounded-2xl', bar: 'bg-primary' },
  'command-deck': {
    panel: 'relative overflow-hidden rounded-lg border border-primary/25 bg-foreground/[0.015] backdrop-blur',
    bar: 'bg-primary',
    font: 'font-mono',
  },
  editorial: { panel: 'rounded-none border-y border-border bg-transparent', bar: 'bg-foreground' },
  holographic: { panel: 'ds-holo-foil rounded-[20px] [&>*]:ds-holo-inner [&>*]:rounded-[18.5px]', bar: 'bg-primary' },
  'mission-control': { panel: 'relative overflow-hidden rounded-2xl border border-border bg-foreground/[0.02]', bar: 'bg-primary' },
  'neon-grid': {
    panel: 'relative z-10 overflow-hidden rounded-lg border border-primary/30 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] backdrop-blur',
    bar: 'bg-primary shadow-[0_0_10px_-2px_var(--primary)]',
    font: 'font-mono',
  },
  orbital: { panel: 'relative overflow-hidden rounded-2xl border border-border bg-foreground/[0.02]', bar: 'bg-primary' },
  spatial: {
    panel: 'relative overflow-hidden rounded-[28px] border border-foreground/15 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] backdrop-blur-2xl backdrop-saturate-150',
    sheen: 'pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,color-mix(in_srgb,var(--foreground)_14%,transparent),transparent_50%)]',
    bar: 'bg-primary',
  },
  // `classic` intentionally omitted — it matches DEFAULT_CHROME exactly, so the fallback covers it.
}

// The panel (+ optional sheen) each skin draws behind the Brain Dump banner, as ONE source of truth for
// both the loaded widget and its skeleton placeholder (`BrainDumpSkel`) — so the two can't drift on the
// Suspense swap. Derived from `SKIN_CHROME` so editing a skin's chrome above updates the skeleton too.
export interface BrainDumpSkinPanel {
  panel: string
  sheen?: string
}

export function brainDumpSkinPanel(skin: UiSkin): BrainDumpSkinPanel {
  const chrome = SKIN_CHROME[skin] ?? DEFAULT_CHROME
  return { panel: chrome.panel, sheen: chrome.sheen }
}

interface BrainDumpWidgetProps {
  skin: UiSkin
  // Optional wrapper override so a skin can tighten the gap to the row below it (the page-level
  // `gap-6` otherwise makes the banner read as a detached extra line — callers collapse it).
  className?: string
}

/**
 * Pro-only Brain Dump banner that sits at the TOP of every dashboard skin (mobile + desktop). A
 * full-width strip: icon + title, the hourly quota meter (remaining/limit + a thin filled bar, with a
 * tooltip carrying the detail), a live "N in progress" badge, and the New / Resume CTAs. Skin-aware
 * chrome (`SKIN_CHROME`) so it reads as a native section of each skin. Calls `useAiUsage()` +
 * `useActiveBrainDumpJobs()` itself — no promise threaded through skin data. Non-Pro is gated by the
 * `{isPro && …}` call site in each skin.
 *
 * The WHOLE card is clickable: "New split" is the card's primary link and carries an
 * `after:absolute after:inset-0` stretched overlay, so a click anywhere in the card's empty space
 * starts a new split. The meter popover and the Review link are raised to `z-10` so they stay
 * independently clickable/focusable "islands" above that overlay — the accessible clickable-card
 * pattern (one primary link + real secondary controls, no nested-interactive nesting).
 */
export function BrainDumpWidget({ skin, className }: BrainDumpWidgetProps) {
  const { data: usage } = useAiUsage()
  const { data: jobsData } = useActiveBrainDumpJobs()
  // Defer meter rendering until after hydration — `useAiUsage` is gated on the Zustand `isPro`
  // flag which starts `false` (SSR default) and is only set in a `useLayoutEffect` after mount.
  // Rendering the meter on the server would produce 0/0 which conflicts with the real values
  // the client sees after the flag initializes, causing a hydration mismatch.
  // `useSyncExternalStore` with a no-op subscribe is the idiomatic way to detect client-side
  // without triggering the react-hooks/set-state-in-effect lint rule.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const meter = usage?.brainDump
  const remaining = meter?.remaining ?? 0
  const limit = meter?.limit ?? 0
  const pct = limit > 0 ? Math.min(100, Math.round((remaining / limit) * 100)) : 0
  const resumeJobs = jobsData?.jobs ?? []
  const resumeJobId = resumeJobs[0]?.id ?? null

  const chrome = SKIN_CHROME[skin] ?? DEFAULT_CHROME

  const isEmpty = remaining <= 0
  const hasResume = resumeJobs.length > 0 && resumeJobId !== null

  // Active jobs span three states (the active list carries `failed` too, per v2.5), so the live pill
  // reuses the shared status vocabulary instead of labeling everything "in progress". It surfaces the
  // single most-actionable state — your turn (ready to review) over needs-attention (failed) over a
  // passive wait (in progress) — with that state's own count. Only a still-streaming run keeps the ping
  // animation; a finished/failed job shows a static dot.
  const reviewCount = resumeJobs.filter((job) => job.status === 'completed').length
  const failedCount = resumeJobs.filter((job) => job.status === 'failed').length
  const processingCount = resumeJobs.filter((job) => job.status === 'processing').length

  let statusPill: { count: number; label: string; active: boolean } | null = null
  if (reviewCount > 0) statusPill = { count: reviewCount, label: BRAIN_DUMP_STATUS_LABEL.completed, active: false }
  else if (failedCount > 0) statusPill = { count: failedCount, label: BRAIN_DUMP_STATUS_LABEL.failed, active: false }
  else if (processingCount > 0) statusPill = { count: processingCount, label: BRAIN_DUMP_STATUS_LABEL.processing, active: true }
  // A quota is a *quantity in a known range*, so it's an ARIA `meter` (not a `progressbar`, which is
  // for progress-over-time) — per the React Aria / APG meter pattern. `aria-valuetext` voices the
  // human reading; min/now/max give the raw range. For a small hourly limit we render discrete PIPS
  // (one token per attempt) — the clearest possible "attempts left" cue — and fall back to a
  // continuous fill only past 12, where individual pips would be too dense to read.
  const usePips = limit > 0 && limit <= 12
  const valueText = `${remaining} of ${limit} ${limit === 1 ? 'split' : 'splits'} left this hour`
  const renewLabel = meter ? formatRenewIn(meter.resetAt) : null

  return (
    <div className={cn('group/bd card-interactive flex h-full flex-col justify-center gap-2.5 px-3.5 py-2.5', chrome.panel, chrome.font, className)}>
      {chrome.sheen && <div className={chrome.sheen} />}

      {/* Primary action — the whole card. A zero-size link (no button chrome) whose
          `after:absolute after:inset-0` overlay stretches across the entire card, so a click anywhere
          starts a new split. The `::after` overlay paints ABOVE the card's static content (unlike an
          `absolute inset-0` link, which sibling text would paint over and steal clicks from), while
          the z-10 meter/Review islands sit above the overlay and stay independently clickable. The
          link carries the card's accessible name; the visual cue is the hover highlight + Row 2 arrow. */}
      <Link
        href="/parse"
        aria-label="Start a new Brain Dump split"
        className="rounded-[inherit] outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
      />

      {/* Row 1 — identity: gradient icon tile + title (+ inline subtitle / live in-progress badge).
          `pointer-events-none` so clicks on the icon/text fall THROUGH to the whole-card primary link
          underneath (otherwise this `relative` row would capture them). Purely display content. */}
      <div className="pointer-events-none relative flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary/30 to-primary/5 text-primary shadow-sm ring-1 ring-inset ring-primary/20 transition-transform duration-300 group-hover/bd:scale-105">
          <Sparkles className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-sm font-semibold tracking-tight">Brain Dump</span>
          <span className="truncate text-xs text-muted-foreground max-lg:hidden">Split a long file into ready-to-save items</span>
          {statusPill && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-inset ring-primary/15">
              <span className="relative flex size-1.5">
                {statusPill.active && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/70" />
                )}
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              {statusPill.count} {statusPill.label}
            </span>
          )}
        </div>
      </div>

      {/* Row 2 — accessible quota meter (info popover on hover AND click/touch) + CTA cluster.
          `pointer-events-none` on the row so its empty space + the non-interactive arrow affordance
          fall through to the whole-card primary link; the two real islands (meter trigger, Review)
          re-enable `pointer-events-auto` to stay independently clickable. */}
      <div className="pointer-events-none relative flex items-center gap-3">
        {/* openOnHover (+ delays) belong on the Trigger per Base UI; click/touch open is the default —
            so the details surface on hover AND on press/tap, as requested. */}
        <Popover>
          <PopoverTrigger
            openOnHover
            delay={120}
            closeDelay={80}
            render={
              <button
                type="button"
                suppressHydrationWarning
                aria-label={mounted ? `Brain Dump quota — ${valueText}. Show details.` : 'Brain Dump quota. Show details.'}
                className="pointer-events-auto relative z-10 -mx-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            <span className="flex shrink-0 items-baseline gap-1 leading-none">
              <NumberTicker value={mounted ? remaining : 0} className={cn('text-sm font-bold tabular-nums', mounted && isEmpty ? 'text-muted-foreground' : 'text-foreground')} suppressHydrationWarning />
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground">left</span>
            </span>
            <span
              role="meter"
              aria-valuemin={0}
              suppressHydrationWarning
              aria-valuemax={mounted ? (limit || 1) : 1}
              aria-valuenow={mounted ? remaining : 0}
              aria-valuetext={mounted ? valueText : '0 splits left this hour'}
              className="flex min-w-0 flex-1 items-center"
            >
              {/* Render a stable bar placeholder before mount to avoid hydration mismatch from the
                  pips-vs-bar branch — `usePips` depends on `limit` which is 0 until the client
                  fetches usage data after the `isPro` Zustand flag initializes. */}
              {!mounted ? (
                <span aria-hidden="true" className="relative block h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/[0.08] ring-1 ring-inset ring-foreground/[0.06]">
                  <span className="block h-full w-0 rounded-full" />
                </span>
              ) : usePips ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5" aria-hidden="true">
                  {Array.from({ length: limit }, (_, i) => {
                    const filled = i < remaining
                    return (
                      <span
                        key={i}
                        className={cn(
                          'h-2 min-w-0 flex-1 rounded-full transition-all duration-500 motion-reduce:transition-none',
                          filled
                            ? cn(chrome.bar, 'shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_25%,transparent)]')
                            : 'bg-foreground/[0.08] ring-1 ring-inset ring-foreground/[0.06]',
                        )}
                      />
                    )
                  })}
                </span>
              ) : (
                <span aria-hidden="true" className="relative block h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/[0.08] ring-1 ring-inset ring-foreground/[0.06]">
                  <span
                    className={cn('block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', isEmpty ? 'bg-muted-foreground/40' : chrome.bar)}
                    style={{ width: `${Math.max(pct, isEmpty ? 0 : 4)}%` }}
                  />
                </span>
              )}
            </span>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-64 gap-0 p-0">
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <Sparkles className="size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold leading-tight">Brain Dump quota</p>
                <p className="text-[11px] leading-tight text-muted-foreground">{remaining} of {limit} new {limit === 1 ? 'split' : 'splits'} left</p>
              </div>
            </div>
            <div className="px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <p>Each new split uses one hourly token. <span className="font-medium text-foreground">Resuming a job is always free.</span></p>
              {renewLabel && (
                <p className="mt-2 flex items-center gap-1.5 text-foreground/80">
                  <Clock className="size-3 shrink-0" />
                  {renewLabel}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Review stays a genuine secondary island (a different destination — resume an active job),
              raised to z-10 above the whole-card primary link. Material allows a directly-actionable
              card to still host distinct interactive elements. */}
          {hasResume && (
            <Link
              href={`/parse/${resumeJobId}`}
              aria-label="Resume Brain Dump review"
              className="pointer-events-auto relative z-10 flex items-center gap-1 rounded-lg border border-border/80 bg-card/60 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent/50"
            >
              <RotateCw className="size-3.5" /> Review{resumeJobs.length > 1 ? ` (${resumeJobs.length})` : ''}
            </Link>
          )}
          {/* The whole card IS the "New split" action, so there's no button here — just its directional
              affordance: a label (desktop) + arrow that slide forward as the card highlights on hover.
              aria-hidden — the accessible name lives on the stretched primary link above. */}
          <span
            aria-hidden="true"
            className="flex items-center gap-1 text-xs font-semibold text-primary transition-all duration-300 group-hover/bd:translate-x-0.5"
          >
            <span className="max-lg:hidden">New split</span>
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/15 transition-colors duration-300 group-hover/bd:bg-primary group-hover/bd:text-primary-foreground">
              <ArrowRight className="size-4" />
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
