'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'
import {
  EDITOR_FONT_SIZE_OPTIONS,
  EDITOR_TAB_SIZE_OPTIONS,
  DEFAULT_EDITOR_PREFERENCES,
} from '@/lib/utils/editor-preferences'
import {
  APP_THEME_OPTIONS,
  UI_SKIN_OPTIONS,
  SKIN_THEME_PRESET,
  isProSkin,
  type AppTheme,
  type UiSkin,
  type EditorThemeMode,
} from '@/types/editor-preferences'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import { CollapsibleCard } from '@/components/shared/collapsible-card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { startThemeTransition, type TransitionEventCoords } from '@/lib/dom/theme-transition'
import { Crown, RotateCcw, LayoutDashboard, Palette, Settings2 } from 'lucide-react'
import { DarkLightSwitch } from '@/components/shared/dark-light-switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// Representative gradient swatch per skin for the picker grid (purely decorative preview).
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

interface EditorThemeModeOption {
  value: EditorThemeMode
  label: string
  description: string
}

const EDITOR_THEME_MODE_OPTIONS: EditorThemeModeOption[] = [
  { value: 'app', label: 'App', description: 'Follows your color palette' },
  { value: 'auto', label: 'Auto', description: 'Monaco native, tracks dark/light' },
  { value: 'dark', label: 'Dark', description: 'Monaco native, always dark' },
]

interface PreferenceRowProps {
  title: string
  description: string
  children: ReactNode
}

function PreferenceRow({ title, description, children }: PreferenceRowProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label>{title}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="w-full sm:w-auto sm:shrink-0">{children}</div>
    </div>
  )
}

export function EditorPreferencesForm() {
  const store = useEditorPreferencesStore()
  const { updatePreference, updatePreferences } = store
  const isPro = useAppUserFlagsStore((s) => s.isPro)
  const { openPrompt } = useUpgradePromptStore()
  const router = useRouter()

  const handleAppThemeChange = (e: TransitionEventCoords, theme: AppTheme) => {
    startThemeTransition(e, () => {
      void updatePreference('appTheme', theme)
    })
  }

  // Pro skins are locked for free users: clicking routes to the upgrade prompt instead of selecting
  // (server-side enforcement is authoritative; this is just the affordance). Selecting a skin also
  // auto-applies its paired App Theme preset (animated with the same view transition as a manual
  // theme change) so the dashboard matches its mockup out of the box; the user can change the theme
  // afterwards. `classic` has no paired theme — it keeps the current appTheme.
  const handleSkinSelect = (e: TransitionEventCoords, skin: UiSkin) => {
    if (isProSkin(skin) && !isPro) {
      openPrompt({
        title: 'Pro dashboard skin',
        description: 'This dashboard skin is only available on the Pro plan. Upgrade to unlock all skins.',
      })
      return
    }
    const themePreset = SKIN_THEME_PRESET[skin]
    const patch = themePreset ? { uiSkin: skin, appTheme: themePreset } : { uiSkin: skin }
    startThemeTransition(e, () => {
      void updatePreferences(patch).then((ok) => {
        // The skin is server-rendered on /dashboard. A route-handler save doesn't clear the client
        // Router Cache, so refresh it here — otherwise the dashboard shows the old skin until reload.
        if (ok) router.refresh()
      })
    })
  }

  const handleReset = (e: TransitionEventCoords) => {
    startThemeTransition(e, () => {
      void updatePreferences(DEFAULT_EDITOR_PREFERENCES)
    })
  }


  const isDark = store.colorMode === 'dark'

  return (
    <div className="space-y-6">
      <CollapsibleCard
        title="Dashboard Skin"
        icon={<LayoutDashboard />}
        subtitle="Choose how your dashboard is laid out. Pro skins unlock bolder, data-rich layouts."
      >
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
            {UI_SKIN_OPTIONS.map((skin) => {
              const isActive = store.uiSkin === skin.value
              const locked = isProSkin(skin.value) && !isPro
              return (
                <button
                  key={skin.value}
                  type="button"
                  onClick={(e) => handleSkinSelect(e, skin.value)}
                  className={cn(
                    'group relative flex flex-col gap-2 rounded-lg border-2 p-3 text-left transition-all hover:bg-foreground/5',
                    isActive ? 'border-primary bg-foreground/5' : 'border-border'
                  )}
                >
                  <div
                    className="relative h-14 w-full overflow-hidden rounded-md ring-1 ring-border/20"
                    style={{ background: SKIN_SWATCHES[skin.value] }}
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
                    <p className="mt-1 line-clamp-2 text-[10px] leading-tight text-muted-foreground">{skin.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        title="App Theme"
        icon={<Palette />}
        subtitle="Choose the global color palette and mode for the application."
        bodyClassName="space-y-6"
      >
          <div className="max-h-[256px] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
            {APP_THEME_OPTIONS.map((theme) => {
              const isActive = store.appTheme === theme.value
              const colors = isDark ? theme.dark : theme.light
              return (
                <button
                  key={theme.value}
                  onClick={(e) => handleAppThemeChange(e, theme.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all hover:bg-foreground/5",
                    isActive ? "border-primary bg-foreground/5" : "border-border"
                  )}
                >
                  <div
                    className="relative size-10 rounded-full ring-2 ring-border/20 shadow-sm overflow-hidden shrink-0"
                    style={{ backgroundColor: colors.bg }}
                  >
                    <div
                      className="absolute bottom-0 right-0 size-4 rounded-tl-full"
                      style={{ backgroundColor: colors.primary }}
                    />
                  </div>
                  <div className="space-y-0.5 text-center min-w-0 w-full">
                    <p className="text-xs font-semibold leading-none truncate">{theme.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight truncate">{theme.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
            <Label>Color Mode</Label>
            <div className="flex items-center gap-3">
              <DarkLightSwitch
                colorMode={store.colorMode}
                onColorModeChange={(mode) => void updatePreference('colorMode', mode)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="gap-1.5"
                title="Revert all theme settings to defaults"
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            </div>
          </div>
      </CollapsibleCard>

      <CollapsibleCard
        title="Editor Settings"
        icon={<Settings2 />}
        subtitle="Customize your editing experience. Changes are saved automatically."
        bodyClassName="space-y-6"
      >
          <PreferenceRow title="Editor Theme" description="Controls syntax highlighting and the editor background">
            <TooltipProvider>
              <div className="flex w-full sm:w-auto rounded-md border border-border overflow-hidden">
                {EDITOR_THEME_MODE_OPTIONS.map((option) => {
                  const isActive = store.editorThemeMode === option.value
                  return (
                    <Tooltip key={option.value}>
                      <TooltipTrigger
                        onClick={() => void updatePreference('editorThemeMode', option.value)}
                        className={cn(
                          "flex-1 sm:flex-none px-3 py-1.5 text-sm font-medium transition-colors text-center",
                          "border-r border-border last:border-r-0",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-foreground hover:bg-muted"
                        )}
                      >
                        {option.label}
                      </TooltipTrigger>
                      <TooltipContent>{option.description}</TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </TooltipProvider>
          </PreferenceRow>

          <PreferenceRow title="Font Size" description="Font size in pixels — code and markdown editors">
            <Select
              value={String(store.fontSize)}
              onValueChange={(v) => { if (v) void updatePreference('fontSize', parseInt(v, 10)) }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Font Size">
                  {store.fontSize}px
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {EDITOR_FONT_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PreferenceRow>

          <PreferenceRow title="Tab Size" description="Spaces per tab — code and markdown editors">
            <Select
              value={String(store.tabSize)}
              onValueChange={(v) => { if (v) void updatePreference('tabSize', parseInt(v, 10)) }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tab Size">
                  {EDITOR_TAB_SIZE_OPTIONS.find((t) => t.value === store.tabSize)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {EDITOR_TAB_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PreferenceRow>

          <PreferenceRow title="Word Wrap" description="Wrap long lines — code and markdown editors">
            <Switch
              checked={store.wordWrap === 'on'}
              onCheckedChange={(checked) => updatePreference('wordWrap', checked ? 'on' : 'off')}
            />
          </PreferenceRow>

          <PreferenceRow title="Minimap" description="Show code minimap on the right — code editor only">
            <Switch
              checked={store.minimap}
              onCheckedChange={(checked) => updatePreference('minimap', checked)}
            />
          </PreferenceRow>
      </CollapsibleCard>
    </div>
  )
}
