import type { EditorPreferences } from '@/client'
import { UI_SKINS, DEFAULT_UI_SKIN } from '@/lib/ui-skins'
import type { UiSkin } from '@/lib/ui-skins'
import { APP_THEMES } from '@/lib/theme-presets.generated'
import type { AppTheme } from '@/lib/theme-presets.generated'

export type ColorMode = 'light' | 'dark'

/**
 * Product defaults, mirroring the legacy `DEFAULT_EDITOR_PREFERENCES`
 * (src/lib/utils/editor-preferences.ts). The backend normalizes on read too, but the SPA
 * needs local defaults for the pre-auth / loading window before the prefs query resolves.
 */
export const DEFAULT_APP_THEME: AppTheme = 'modern-minimal'
export const DEFAULT_COLOR_MODE: ColorMode = 'dark'

export function normalizeAppTheme(input: string | undefined): AppTheme {
  // `.find` returns `AppTheme | undefined` directly — no cast, so the value is proven to be a
  // real member rather than asserted into the union.
  return APP_THEMES.find((t) => t === input) ?? DEFAULT_APP_THEME
}

export function normalizeColorMode(input: string | undefined): ColorMode {
  return input === 'light' || input === 'dark' ? input : DEFAULT_COLOR_MODE
}

export function normalizeUiSkin(input: string | undefined): UiSkin {
  return UI_SKINS.find((s) => s === input) ?? DEFAULT_UI_SKIN
}

// Cookie the no-flash pre-hydration script reads to apply the saved theme before first paint,
// so a non-default theme doesn't flash the default first. `ds-theme=<appTheme>|<colorMode>`.
export const THEME_COOKIE = 'ds-theme'

/**
 * Apply the theme to <html>: the `data-theme` slug selects the token block from
 * themes.generated.css, and the `dark`/`light` class selects the color mode. This is a
 * deliberate direct-DOM write on documentElement (no React alternative — the <html> element is
 * outside the React tree; this is the same mechanism next-themes uses), mirrored to a cookie so
 * the pre-hydration script can restore it. Safe to call only in the browser.
 */
export function applyTheme(appTheme: AppTheme, colorMode: ColorMode): void {
  const root = document.documentElement
  // Bracket access: `dataset.theme` (dot) trips tsc's noPropertyAccessFromIndexSignature, while
  // setAttribute trips oxlint's prefer-dom-node-dataset — bracket satisfies both.
  root.dataset['theme'] = appTheme
  root.classList.toggle('dark', colorMode === 'dark')
  root.classList.toggle('light', colorMode === 'light')
  // 1-year persistent cookie; SameSite=Lax is enough (no cross-site theme need), path=/ so
  // every route's pre-hydration script sees it.
  document.cookie = `${THEME_COOKIE}=${appTheme}|${colorMode}; path=/; max-age=31536000; SameSite=Lax`
}

export interface ThemePreferences {
  appTheme: AppTheme
  colorMode: ColorMode
}

/** Pull the theme fields off a prefs blob, normalized to valid values. */
export function themeFromPreferences(prefs: EditorPreferences): ThemePreferences {
  return {
    appTheme: normalizeAppTheme(prefs.appTheme),
    colorMode: normalizeColorMode(prefs.colorMode),
  }
}
