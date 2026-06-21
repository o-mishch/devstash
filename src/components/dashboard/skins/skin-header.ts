import type { UiSkin } from '@/types/ui-skins'

// Single source of truth for each skin's SkinWidget header-wrapper padding: negative margins bleed the
// full-width clickable header out to the panel edges, then the panel's own padding (5 / 6 / 22px) is
// restored plus a pb-3 gap. Consumed by every skin's SkinWidget sections AND by AiUsageWidget so the
// "AI Usage" header lines up with its neighbours — change a skin's panel padding here, not in N places.
export const SKIN_HEADER_WRAPPER_CLASS: Partial<Record<UiSkin, string>> = {
  orbital: '-mx-5 -mt-5 px-5 pt-5 pb-3',
  'mission-control': '-mx-5 -mt-5 px-5 pt-5 pb-3',
  'neon-grid': '-mx-5 -mt-5 px-5 pt-5 pb-3',
  holographic: '-mx-[22px] -mt-[22px] px-[22px] pt-[22px] pb-3',
  spatial: '-mx-6 -mt-6 px-6 pt-6 pb-3',
  aurora: '-mx-5 -mt-5 px-5 pt-5 pb-3',
  'command-deck': '-mx-5 -mt-5 px-5 pt-5 pb-3',
}
