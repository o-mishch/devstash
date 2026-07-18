// UI skins — distinct dashboard layouts selected per user and persisted in the
// `editorPreferences` blob (uiSkin). A per-stack copy of the legacy src/types/ui-skins.ts
// (kept in sync by value, per .agents/rules/boundary.md — duplicate across the boundary
// rather than import across it). The list is hand-authored (a fixed product surface), unlike
// the generated theme presets.

import type { AppTheme } from '@/lib/theme-presets.generated'

export const UI_SKINS = [
  'classic',
  'aurora',
  'editorial',
  'spatial',
  'command-deck',
  'orbital',
  'mission-control',
  'neon-grid',
  'holographic',
] as const

export type UiSkin = (typeof UI_SKINS)[number]

export type UiSkinTier = 'free' | 'pro'

export interface UiSkinOption {
  value: UiSkin
  label: string
  description: string
  tier: UiSkinTier
}

// Default skin is the dashboard exactly as it ships today, so existing users are unchanged.
export const DEFAULT_UI_SKIN: UiSkin = 'classic'

export const UI_SKIN_OPTIONS: UiSkinOption[] = [
  {
    value: 'classic',
    label: 'Classic',
    description: 'The current dashboard — stat cards, collections, pinned & recent.',
    tier: 'free',
  },
  {
    value: 'aurora',
    label: 'Aurora Bento',
    description: 'Glass bento grid with a usage ring and type bars.',
    tier: 'free',
  },
  {
    value: 'editorial',
    label: 'Editorial',
    description: 'Swiss/typographic layout with oversized numerals.',
    tier: 'free',
  },
  {
    value: 'spatial',
    label: 'Spatial Depth',
    description: 'visionOS-style frosted floating panels.',
    tier: 'pro',
  },
  {
    value: 'command-deck',
    label: 'Command Deck',
    description: 'HUD/terminal readouts with a segmented type bar.',
    tier: 'pro',
  },
  {
    value: 'orbital',
    label: 'Orbital Core',
    description: 'Item-type constellation orbiting a glowing core.',
    tier: 'pro',
  },
  {
    value: 'mission-control',
    label: 'Mission Control',
    description: 'Analytics cockpit: activity heatmap, donut & sparklines.',
    tier: 'pro',
  },
  {
    value: 'neon-grid',
    label: 'Neon Grid',
    description: 'Synthwave neon outlines over a grid horizon.',
    tier: 'pro',
  },
  {
    value: 'holographic',
    label: 'Holographic',
    description: 'Iridescent animated foil borders on glossy cards.',
    tier: 'pro',
  },
]

const PRO_UI_SKINS: ReadonlySet<UiSkin> = new Set(
  UI_SKIN_OPTIONS.filter((o) => o.tier === 'pro').map((o) => o.value),
)

export function isProSkin(skin: UiSkin): boolean {
  return PRO_UI_SKINS.has(skin)
}

// A free user whose stored skin is Pro-only falls back to the default. The server is
// authoritative (see the Go `me` package); this is the client mirror for immediate UI.
export function resolveAccessibleSkin(skin: UiSkin, isPro: boolean): UiSkin {
  if (!isPro && isProSkin(skin)) return DEFAULT_UI_SKIN
  return skin
}

// Each non-classic skin ships with a matching App Theme preset (same slug) auto-applied when
// the skin is selected, so the dashboard matches its mockup out of the box. `classic` keeps
// whatever theme the user already has. Users can re-theme any skin afterward.
export const SKIN_THEME_PRESET: Record<UiSkin, AppTheme | null> = {
  classic: null,
  aurora: 'aurora',
  editorial: 'editorial',
  spatial: 'spatial',
  'command-deck': 'command-deck',
  orbital: 'orbital',
  'mission-control': 'mission-control',
  'neon-grid': 'neon-grid',
  holographic: 'holographic',
}
