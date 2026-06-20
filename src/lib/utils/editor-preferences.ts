import { APP_THEMES, UI_SKINS, DEFAULT_UI_SKIN } from '@/types/editor-preferences'
import type { EditorPreferences, UiSkin } from '@/types/editor-preferences'

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: 'off',
  minimap: false,
  appTheme: 'modern-minimal',
  colorMode: 'dark',
  editorThemeMode: 'app',
  uiSkin: DEFAULT_UI_SKIN,
  sidebarCollapsed: false,
}

// Clamp an unknown/invalid skin to the default. Unknown values (e.g. a renamed/removed skin in an
// old prefs blob) silently fall back so existing users always load a valid layout.
export function normalizeUiSkin(input: unknown): UiSkin {
  return typeof input === 'string' && (UI_SKINS as readonly string[]).includes(input)
    ? (input as UiSkin)
    : DEFAULT_UI_SKIN
}

export function normalizeEditorPreferences(input: unknown): EditorPreferences {
  if (!input || typeof input !== 'object') {
    return DEFAULT_EDITOR_PREFERENCES
  }
  const typed = input as Partial<EditorPreferences>

  const appTheme = (typed.appTheme && (APP_THEMES as readonly string[]).includes(typed.appTheme))
    ? typed.appTheme
    : DEFAULT_EDITOR_PREFERENCES.appTheme

  const colorMode = (typed.colorMode === 'light' || typed.colorMode === 'dark')
    ? typed.colorMode
    : DEFAULT_EDITOR_PREFERENCES.colorMode

  return {
    fontSize: typeof typed.fontSize === 'number' && typed.fontSize >= 8 && typed.fontSize <= 100
      ? typed.fontSize
      : DEFAULT_EDITOR_PREFERENCES.fontSize,
    tabSize: typeof typed.tabSize === 'number' && typed.tabSize >= 1 && typed.tabSize <= 16
      ? typed.tabSize
      : DEFAULT_EDITOR_PREFERENCES.tabSize,
    wordWrap: typed.wordWrap === 'on' || typed.wordWrap === 'off'
      ? typed.wordWrap
      : DEFAULT_EDITOR_PREFERENCES.wordWrap,
    minimap: typeof typed.minimap === 'boolean'
      ? typed.minimap
      : DEFAULT_EDITOR_PREFERENCES.minimap,
    appTheme,
    colorMode,
    editorThemeMode: (typed.editorThemeMode === 'app' || typed.editorThemeMode === 'auto' || typed.editorThemeMode === 'dark')
      ? typed.editorThemeMode
      : DEFAULT_EDITOR_PREFERENCES.editorThemeMode,
    uiSkin: normalizeUiSkin(typed.uiSkin),
    sidebarCollapsed: typeof typed.sidebarCollapsed === 'boolean'
      ? typed.sidebarCollapsed
      : DEFAULT_EDITOR_PREFERENCES.sidebarCollapsed,
  }
}

export const EDITOR_FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20]

export const EDITOR_TAB_SIZE_OPTIONS = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 8, label: '8 spaces' },
]
