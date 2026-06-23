import type { UiSkin } from '@/types/ui-skins'

export interface SkinChrome {
  // The outer panel classes (border/background/radius/blur) — matches the skin's section chrome.
  panel: string
  // Optional inner sheen/overlay element rendered absolutely behind the content (spatial/holographic).
  sheen?: string
  // The accent bar fill for the quota meter.
  bar: string
  // Extra trigger/heading classes (e.g. mono for command-deck / neon-grid).
  font?: string
}

export const DEFAULT_CHROME: SkinChrome = {
  // Matches the classic stat chips' left-accent treatment so Brain Dump reads as one of the row: a
  // 2px left border in the primary accent, dimmed at rest and brightening to full color on hover/press
  // (the chips use --stat-accent; here the accent is the primary). `card-interactive` supplies the lift.
  panel:
    'rounded-xl border border-l-2 border-border border-l-[color-mix(in_oklab,var(--primary),transparent_55%)] bg-card hover:border-l-primary active:border-l-primary',
  bar: 'bg-primary',
}

export const SKIN_CHROME: Partial<Record<UiSkin, SkinChrome>> = {
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
