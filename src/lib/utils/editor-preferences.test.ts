import { describe, it, expect } from 'vitest'
import { normalizeEditorPreferences, DEFAULT_EDITOR_PREFERENCES } from './editor-preferences'

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
      dashboardSections: { collections: true, pinned: true, recent: true },
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
      dashboardSections: { collections: false, pinned: true, recent: false },
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
    } as unknown
    expect(normalizeEditorPreferences(invalid)).toEqual(DEFAULT_EDITOR_PREFERENCES)
  })
})
