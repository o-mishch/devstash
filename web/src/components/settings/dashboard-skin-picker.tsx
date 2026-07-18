import type { CSSProperties, ReactNode } from 'react'
import { Crown, LayoutDashboard } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/auth/session'
import { useEditorPreferences, useUpdatePreferences } from '@/hooks/use-preferences'
import { SKIN_THEME_PRESET, UI_SKIN_OPTIONS, isProSkin } from '@/lib/ui-skins'
import type { UiSkin } from '@/lib/ui-skins'
import { normalizeUiSkin } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { SettingsSection } from './settings-section'

// Decorative gradient swatch per skin for the picker grid (mirrors the legacy SKIN_SWATCHES).
const SKIN_SWATCHES: Record<UiSkin, string> = {
  classic: 'linear-gradient(135deg, var(--muted), var(--card))',
  aurora: 'linear-gradient(135deg, #4f7cff, #7c5cff)',
  editorial: 'linear-gradient(135deg, #e5e7eb, #6b7280)',
  spatial: 'linear-gradient(135deg, rgba(124,92,255,0.6), rgba(34,211,238,0.5))',
  'command-deck': 'linear-gradient(135deg, #22d3ee, #0f172a)',
  orbital: 'radial-gradient(circle at 35% 30%, #4f7cff, #0c0e16)',
  'mission-control': 'linear-gradient(135deg, #3b82f6, #8b5cf6, #10b981)',
  'neon-grid': 'linear-gradient(135deg, #22d3ee, #ec4899)',
  holographic: 'conic-gradient(from 0deg, #22d3ee, #4f7cff, #8b5cf6, #ec4899, #fde047, #22d3ee)',
}

// Feeds the swatch's decorative gradient in via a CSS var, consumed by an arbitrary-value
// Tailwind class (mirrors dashboard/stat-chip.tsx's statAccentStyle pattern).
function swatchGradientStyle(skin: UiSkin): CSSProperties {
  return { '--skin-gradient': SKIN_SWATCHES[skin] }
}

/**
 * The dashboard-skin grid. Selecting a skin persists `uiSkin` and, for non-classic skins,
 * auto-applies its paired App Theme preset so the dashboard matches its mockup out of the box.
 * Pro skins are locked for free users (server-side enforcement is authoritative; this is the
 * affordance) — clicking one nudges toward Billing rather than selecting.
 * KNOWN GAP: server-side enforcement described above does not exist yet — the backend has no
 * subscription-status field to check until Backend 5 (Stripe/billing, see
 * context/current-feature.md) ships, so this client-side gate is not yet backed by a real
 * server-side check and can be bypassed via a direct API call.
 */
export function DashboardSkinPicker(): ReactNode {
  const { data: session } = useSession()
  const { data: prefs } = useEditorPreferences()
  const update = useUpdatePreferences()
  const isPro = session?.user.isPro === true
  const activeSkin = normalizeUiSkin(prefs?.uiSkin)

  const selectSkin = (skin: UiSkin): void => {
    if (isProSkin(skin) && !isPro) {
      toast.info('That dashboard skin is a Pro feature — upgrade in Billing to unlock it.')
      return
    }
    const preset = SKIN_THEME_PRESET[skin]
    update.mutate({
      body: preset === null ? { uiSkin: skin } : { uiSkin: skin, appTheme: preset },
    })
  }

  return (
    <SettingsSection
      icon={LayoutDashboard}
      title="Dashboard Skin"
      subtitle="Choose how your dashboard is laid out. Pro skins unlock bolder, data-rich layouts."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {UI_SKIN_OPTIONS.map((skin) => {
          const isActive = activeSkin === skin.value
          const locked = isProSkin(skin.value) && !isPro
          return (
            <button
              key={skin.value}
              type="button"
              onClick={() => selectSkin(skin.value)}
              aria-pressed={isActive}
              className={cn(
                'group relative flex flex-col gap-2 rounded-lg border-2 p-3 text-left transition-all hover:bg-foreground/5',
                isActive ? 'border-primary bg-foreground/5' : 'border-border',
              )}
            >
              <div
                className="relative h-14 w-full overflow-hidden rounded-md bg-[var(--skin-gradient)] ring-1 ring-border/20"
                // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (skin gradient preview)
                style={swatchGradientStyle(skin.value)}
              >
                {locked && (
                  <span className="absolute inset-0 grid place-items-center bg-black/40">
                    <Crown className="size-4 text-amber-300" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-xs font-semibold leading-none">{skin.label}</p>
                  {skin.tier === 'pro' && (
                    <span className="shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-500">
                      Pro
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-tight text-muted-foreground">
                  {skin.description}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </SettingsSection>
  )
}
