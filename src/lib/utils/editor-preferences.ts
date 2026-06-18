import { APP_THEMES } from '@/types/editor-preferences'
import type { DashboardSections, EditorPreferences } from '@/types/editor-preferences'

const DEFAULT_DASHBOARD_SECTIONS: DashboardSections = {
  collections: true,
  pinned: true,
  recent: true,
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: 'off',
  minimap: false,
  appTheme: 'modern-minimal',
  colorMode: 'dark',
  editorThemeMode: 'auto',
  dashboardSections: DEFAULT_DASHBOARD_SECTIONS,
}

function normalizeDashboardSections(input: unknown): DashboardSections {
  if (!input || typeof input !== 'object') return DEFAULT_DASHBOARD_SECTIONS
  const typed = input as Record<string, unknown>
  return {
    collections: typeof typed.collections === 'boolean' ? typed.collections : DEFAULT_DASHBOARD_SECTIONS.collections,
    pinned: typeof typed.pinned === 'boolean' ? typed.pinned : DEFAULT_DASHBOARD_SECTIONS.pinned,
    recent: typeof typed.recent === 'boolean' ? typed.recent : DEFAULT_DASHBOARD_SECTIONS.recent,
  }
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
    dashboardSections: normalizeDashboardSections(typed.dashboardSections),
  }
}

export const EDITOR_FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20]

export const EDITOR_TAB_SIZE_OPTIONS = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 8, label: '8 spaces' },
]
