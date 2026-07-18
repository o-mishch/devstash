import type { CSSProperties, ReactNode } from 'react'
import { Moon, Palette, RotateCcw, Sun } from 'lucide-react'
import { useEditorPreferences, useUpdatePreferences } from '@/hooks/use-preferences'
import { APP_THEME_OPTIONS } from '@/lib/theme-presets.generated'
import type { ThemePresetOption } from '@/lib/theme-presets.generated'
import { DEFAULT_APP_THEME, normalizeAppTheme, normalizeColorMode } from '@/lib/theme'
import type { ColorMode } from '@/lib/theme'
import { DEFAULT_UI_SKIN } from '@/lib/ui-skins'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SettingsSection } from './settings-section'

// The fields the Reset control reverts — the product defaults for everything the settings page
// exposes (theme, mode, skin, and editor knobs).
const RESET_PREFERENCES = {
  appTheme: DEFAULT_APP_THEME,
  colorMode: 'dark',
  uiSkin: DEFAULT_UI_SKIN,
  fontSize: 14,
  tabSize: 2,
  wordWrap: 'off',
} as const

/** The 51-preset App Theme grid plus the color-mode toggle and a reset-to-defaults control. */
export function AppThemePicker(): ReactNode {
  const { data: prefs } = useEditorPreferences()
  const update = useUpdatePreferences()
  const appTheme = normalizeAppTheme(prefs?.appTheme)
  const colorMode = normalizeColorMode(prefs?.colorMode)

  const setColorMode = (mode: ColorMode): void => {
    if (mode !== colorMode) update.mutate({ body: { colorMode: mode } })
  }

  return (
    <SettingsSection
      icon={Palette}
      title="App Theme"
      subtitle="Choose the global color palette and mode for the application."
    >
      <div className="flex flex-col gap-6">
        <div className="max-h-64 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {APP_THEME_OPTIONS.map((theme) => (
              <ThemeSwatch
                key={theme.value}
                theme={theme}
                isDark={colorMode === 'dark'}
                isActive={appTheme === theme.value}
                onSelect={() => update.mutate({ body: { appTheme: theme.value } })}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <span className="text-sm font-medium">Color Mode</span>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
              <ModeButton
                active={colorMode === 'light'}
                onClick={() => setColorMode('light')}
                label="Light"
              >
                <Sun className="size-4" />
              </ModeButton>
              <ModeButton
                active={colorMode === 'dark'}
                onClick={() => setColorMode('dark')}
                label="Dark"
              >
                <Moon className="size-4" />
              </ModeButton>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => update.mutate({ body: RESET_PREFERENCES })}
              title="Revert all theme settings to defaults"
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}

// Feeds a preview color in via a CSS var, consumed by a matching arbitrary-value Tailwind class
// (mirrors dashboard/stat-chip.tsx's statAccentStyle pattern).
function swatchColorStyle(color: string): CSSProperties {
  return { '--swatch-color': color }
}

interface ThemeSwatchProps {
  theme: ThemePresetOption
  isDark: boolean
  isActive: boolean
  onSelect: () => void
}

function ThemeSwatch({ theme, isDark, isActive, onSelect }: ThemeSwatchProps): ReactNode {
  const colors = isDark ? theme.dark : theme.light
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Apply ${theme.label} app theme`}
      aria-pressed={isActive}
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all hover:bg-foreground/5',
        isActive ? 'border-primary bg-foreground/5' : 'border-border',
      )}
    >
      <div
        className="relative size-10 shrink-0 overflow-hidden rounded-full bg-[var(--swatch-color)] shadow-sm ring-2 ring-border/20"
        // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (theme swatch bg)
        style={swatchColorStyle(colors.bg)}
      >
        <div
          className="absolute bottom-0 right-0 size-4 rounded-tl-full bg-[var(--swatch-color)]"
          // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (theme swatch primary)
          style={swatchColorStyle(colors.primary)}
        />
      </div>
      <p className="w-full truncate text-center text-xs font-semibold leading-none">
        {theme.label}
      </p>
    </button>
  )
}

interface ModeButtonProps {
  active: boolean
  label: string
  onClick: () => void
  children: ReactNode
}

function ModeButton({ active, label, onClick, children }: ModeButtonProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
      {label}
    </button>
  )
}
