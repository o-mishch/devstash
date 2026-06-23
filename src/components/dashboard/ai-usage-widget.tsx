'use client'

import { Sparkles, Lightbulb, Tag, AlignLeft, Gauge, type LucideIcon } from 'lucide-react'
import type { UiSkin } from '@/types/ui-skins'
import { Skeleton } from '@/components/ui/skeleton'
import { NumberTicker } from '@/components/ui/number-ticker'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useAiUsage, type AiFeatureUsage } from '@/hooks/use-ai-usage'
import { formatRenewIn } from '@/lib/utils/format'
import { DashboardWidget } from '@/components/dashboard/dashboard-widget'
import { SkinWidget } from './skins/skin-widget'
import { cn } from '@/lib/utils'

// Per-feature display config, keyed by the AI rate-limit key the API returns. The API order is
// Optimize · Explain · Tags · Description (see AI_RATE_LIMIT_KEYS), so the section reads left→right.
// `description` explains what the feature does (surfaced in the per-card info popover).
interface FeatureMeta {
  label: string
  icon: LucideIcon
  description: string
}

const FEATURE_META: Record<string, FeatureMeta> = {
  aiOptimize: { label: 'Optimize', icon: Sparkles, description: 'Rewrites a saved prompt to be clearer and more effective.' },
  aiExplain: { label: 'Explain', icon: Lightbulb, description: 'Generates a plain-language explanation of a code snippet or command.' },
  aiTags: { label: 'Tags', icon: Tag, description: 'Suggests relevant tags for an item from its title and content.' },
  aiDescription: { label: 'Description', icon: AlignLeft, description: 'Writes a short description for an item or collection.' },
}

// Visual treatment per skin. A flat lookup (not nested ternaries) keyed by skin, with a default for
// the token-light free skins. Bold/Pro skins lean on the primary accent + a subtle inset glow.
interface SkinTreatment {
  card: string
  bar: string
}

const DEFAULT_TREATMENT: SkinTreatment = {
  card: 'border-border bg-foreground/[0.02]',
  bar: 'bg-primary',
}

const SKIN_TREATMENTS: Partial<Record<UiSkin, SkinTreatment>> = {
  'mission-control': { card: 'border-primary/20 bg-primary/[0.04]', bar: 'bg-primary' },
  orbital: { card: 'border-primary/20 bg-foreground/[0.03]', bar: 'bg-primary' },
  'command-deck': { card: 'border-primary/25 bg-foreground/[0.03] font-mono', bar: 'bg-primary' },
  'neon-grid': { card: 'border-primary/30 bg-foreground/[0.03]', bar: 'bg-primary shadow-[0_0_10px_-2px_var(--primary)]' },
  holographic: { card: 'border-primary/20 bg-foreground/[0.03]', bar: 'bg-primary' },
  spatial: { card: 'border-border bg-foreground/[0.04]', bar: 'bg-primary' },
}

// Per-skin header styling, mirroring exactly what each skin passes to its OWN SkinWidget
// sections (Collections / Pinned / Recent) so the "AI Usage" header keeps the same identity and hover
// behavior as its neighbours. Skins that use the default header pass nothing.
const SKIN_HEADER_CLASS: Partial<Record<UiSkin, string>> = {
  editorial: 'tracking-[0.1em] text-foreground',
  'neon-grid': 'font-mono tracking-[0.1em] text-primary',
}

interface AiUsageWidgetProps {
  skin: UiSkin
}

/**
 * Per-skin AI Usage section (Pro-only). A compact, low-emphasis utility strip — one slim meter per
 * AI feature (icon, an animated remaining/limit readout, a thin usage bar), with the renewal/limit
 * detail tucked into a hover/tap popover rather than always-on. Deliberately demoted: it lives at the
 * bottom of each skin, below the day-to-day content (Recent / Pinned / Collections), since usage is
 * occasional-reassurance data, not primary work data. Calls `useAiUsage()` itself (no promise threaded
 * through skin data) and shows a matching skeleton on first paint so there is no layout shift. Built
 * with `@container` queries so it adapts to each skin's slot width without per-skin breakpoints.
 */
export function AiUsageWidget({ skin }: AiUsageWidgetProps) {
  const { data, isLoading, isError } = useAiUsage()
  const treatment = SKIN_TREATMENTS[skin] ?? DEFAULT_TREATMENT

  // The read fails open (the route always returns 200), so an error here means the request never
  // reached the route (offline / aborted). Hide the section rather than leaving a permanent skeleton —
  // usage is reassurance data, not primary content. (Non-Pro is already gated by the `{isPro && …}`
  // call site in each skin.)
  if (isError && !data) return null

  const cards = (
    <div className="grid grid-cols-2 gap-2.5 @md:grid-cols-4">
      {isLoading || !data
        ? Array.from({ length: 4 }, (_, i) => <UsageMeterSkeleton key={i} treatment={treatment} />)
        : data.features.map((feature) => (
            <UsageMeter key={feature.key} feature={feature} treatment={treatment} />
          ))}
    </div>
  )

  // Match the host skin's own section component so AI Usage looks and behaves identically to its
  // neighbours (header hover/highlight, chevron, full-header click target, card chrome). Classic uses
  // the Card-based DashboardWidget; every other skin uses SkinWidget inside the
  // skin's own panel chrome.
  if (skin === 'classic') {
    return (
      <div className="@container">
        <DashboardWidget icon={Gauge} title="AI Usage">
          {cards}
        </DashboardWidget>
      </div>
    )
  }

  return (
    <div className="@container">
      <SkinWidget
        icon={<Gauge />}
        title="AI Usage"
        headerClassName={SKIN_HEADER_CLASS[skin]}
        skin={skin}
      >
        {cards}
      </SkinWidget>
    </div>
  )
}

interface UsageMeterProps {
  feature: AiFeatureUsage
  treatment: SkinTreatment
}

function UsageMeter({ feature, treatment }: UsageMeterProps) {
  const meta = FEATURE_META[feature.key] ?? { label: feature.key, icon: Gauge, description: '' }
  const Icon = meta.icon
  const pct = feature.limit > 0 ? Math.min(100, Math.round((feature.remaining / feature.limit) * 100)) : 0

  // One Popover serves both surfaces: `openOnHover` opens it on hover (desktop), while the trigger's
  // click opens it on tap (mobile). Base UI tooltips are disabled on touch devices, so a Popover is
  // the touch-friendly affordance for the "what does this mean" hint. The renewal countdown + hourly
  // limit live here (not on the always-visible strip) to keep the demoted meter slim.
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        render={
          <button
            type="button"
            aria-label={`${meta.label} — ${meta.description}`}
            className={cn(
              'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring',
              treatment.card,
            )}
          />
        }
      >
        <Icon className="card-icon size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-medium text-muted-foreground">{meta.label}</span>
            <span className="flex items-baseline gap-0.5 text-xs font-semibold text-foreground">
              <NumberTicker value={feature.remaining} className="tabular-nums text-foreground" />
              <span className="font-medium tabular-nums text-muted-foreground">/{feature.limit}</span>
            </span>
          </span>
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-foreground/10">
            <span
              className={cn('block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', treatment.bar)}
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-auto max-w-[240px] gap-1 px-3 py-2">
        <p className="text-xs font-semibold text-popover-foreground">{meta.label}</p>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
        <p className="text-[11px] text-muted-foreground/80">{formatRenewIn(feature.resetAt)} · up to {feature.limit} runs/hr.</p>
      </PopoverContent>
    </Popover>
  )
}

interface UsageMeterSkeletonProps {
  treatment: SkinTreatment
}

// Mirrors the compact meter shape so first paint reserves the exact final layout (no shift).
function UsageMeterSkeleton({ treatment }: UsageMeterSkeletonProps) {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2', treatment.card)}>
      <Skeleton className="size-4 shrink-0 rounded" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="mt-1.5 h-1 w-full rounded-full" />
      </div>
    </div>
  )
}
