// UI skins — distinct dashboard layouts (and, in later phases, app-wide ambient identity)
// selected per user and persisted in the existing `editorPreferences` JSON column. Mirrors the
// shape of theme-presets (`UI_SKINS` list + `UI_SKIN_OPTIONS` metadata + `UiSkin` union) but the
// list is hand-authored, not generated, since the skins are a fixed product surface. Client-safe.

import type { AppTheme } from './theme-presets.generated'

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

export type UiSkin = typeof UI_SKINS[number]

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
  { value: 'classic', label: 'Classic', description: 'The current dashboard — stat cards, collections, pinned & recent.', tier: 'free' },
  { value: 'aurora', label: 'Aurora Bento', description: 'Glass bento grid with a usage ring and type bars.', tier: 'free' },
  { value: 'editorial', label: 'Editorial', description: 'Swiss/typographic layout with oversized numerals.', tier: 'free' },
  { value: 'spatial', label: 'Spatial Depth', description: 'visionOS-style frosted floating panels.', tier: 'pro' },
  { value: 'command-deck', label: 'Command Deck', description: 'HUD/terminal readouts with a segmented type bar.', tier: 'pro' },
  { value: 'orbital', label: 'Orbital Core', description: 'Item-type constellation orbiting a glowing core.', tier: 'pro' },
  { value: 'mission-control', label: 'Mission Control', description: 'Analytics cockpit: activity heatmap, donut & sparklines.', tier: 'pro' },
  { value: 'neon-grid', label: 'Neon Grid', description: 'Synthwave neon outlines over a grid horizon.', tier: 'pro' },
  { value: 'holographic', label: 'Holographic', description: 'Iridescent animated foil borders on glossy cards.', tier: 'pro' },
]

const PRO_UI_SKINS: ReadonlySet<UiSkin> = new Set(
  UI_SKIN_OPTIONS.filter((o) => o.tier === 'pro').map((o) => o.value),
)

export function isProSkin(skin: UiSkin): boolean {
  return PRO_UI_SKINS.has(skin)
}

// Server-authoritative gate: a free user whose stored skin is Pro-only falls back to the default.
// Never trust the client to enforce this.
export function resolveAccessibleSkin(skin: UiSkin, isPro: boolean): UiSkin {
  if (!isPro && isProSkin(skin)) return DEFAULT_UI_SKIN
  return skin
}

// Each non-classic skin ships with a matching App Theme preset (same slug) that is auto-applied when
// the skin is selected, so the dashboard matches its mockup out of the box. `classic` keeps whatever
// theme the user already has (it rides the global appTheme). This pairing is only the initial default
// applied on selection — users can still change the theme for any skin afterwards.
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
