import { describe, it, expect } from 'vitest'
import { normalizeEditorPreferences, normalizeUiSkin, DEFAULT_EDITOR_PREFERENCES } from './editor-preferences'
import { DEFAULT_UI_SKIN } from '@/types/editor-preferences'

describe('normalizeEditorPreferences', () => {
  it('returns default preferences on null or undefined input', () => {
    // Snapshot is always consistent with DEFAULT_EDITOR_PREFERENCES (change the constant, test stays valid)
    expect(normalizeEditorPreferences(null)).toEqual(DEFAULT_EDITOR_PREFERENCES)
    expect(normalizeEditorPreferences(undefined)).toEqual(DEFAULT_EDITOR_PREFERENCES)
    expect(normalizeEditorPreferences({})).toEqual(DEFAULT_EDITOR_PREFERENCES)
  })

  it('preserves valid preferences', () => {
    const valid = {
      fontSize: 16,
      tabSize: 4,
      wordWrap: 'on' as const,
      minimap: true,
      appTheme: 'claude' as const,
      colorMode: 'light' as const,
      editorThemeMode: 'app' as const,
      uiSkin: 'aurora' as const,
      sidebarCollapsed: true,
    }
    expect(normalizeEditorPreferences(valid)).toEqual(valid)
  })

  it('preserves editorThemeMode: dark (pinned dark regardless of color mode)', () => {
    const withDarkTheme = {
      fontSize: 14,
      tabSize: 2,
      wordWrap: 'off' as const,
      minimap: false,
      appTheme: 'catppuccin' as const,
      colorMode: 'light' as const,
      editorThemeMode: 'dark' as const,
      uiSkin: 'mission-control' as const,
      sidebarCollapsed: false,
    }
    expect(normalizeEditorPreferences(withDarkTheme)).toEqual(withDarkTheme)
  })

  it('corrects invalid or out of range fields', () => {
    const invalid = {
      fontSize: 999,
      tabSize: -1,
      wordWrap: 'invalid-wrap',
      minimap: 'not-a-bool',
      appTheme: 'invalid-theme',
      colorMode: 'invalid-mode',
      editorThemeMode: 'invalid-mode',
      uiSkin: 'invalid-skin',
    } as unknown
    expect(normalizeEditorPreferences(invalid)).toEqual(DEFAULT_EDITOR_PREFERENCES)
  })

  it('ignores unknown legacy keys (e.g. removed dashboardSections) without erroring', () => {
    const legacy = {
      ...DEFAULT_EDITOR_PREFERENCES,
      dashboardSections: { collections: false, pinned: true, recent: false },
    } as unknown
    const result = normalizeEditorPreferences(legacy)
    expect(result).toEqual(DEFAULT_EDITOR_PREFERENCES)
    expect('dashboardSections' in result).toBe(false)
  })

  it('clamps an unknown uiSkin to the default skin', () => {
    expect(normalizeEditorPreferences({ uiSkin: 'nope' }).uiSkin).toBe(DEFAULT_UI_SKIN)
  })
})

describe('normalizeUiSkin', () => {
  it('accepts a known skin', () => {
    expect(normalizeUiSkin('holographic')).toBe('holographic')
  })

  it('falls back to default for unknown / non-string input', () => {
    expect(normalizeUiSkin('unknown')).toBe(DEFAULT_UI_SKIN)
    expect(normalizeUiSkin(42)).toBe(DEFAULT_UI_SKIN)
    expect(normalizeUiSkin(null)).toBe(DEFAULT_UI_SKIN)
  })
})
