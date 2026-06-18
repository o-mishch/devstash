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
      useDefaultEditorTheme: true,
    }
    expect(normalizeEditorPreferences(valid)).toEqual(valid)
  })

  it('preserves useDefaultEditorTheme: false (opt-in preset colours)', () => {
    const withPresetTheme = {
      fontSize: 14,
      tabSize: 2,
      wordWrap: 'off' as const,
      minimap: false,
      appTheme: 'catppuccin' as const,
      colorMode: 'dark' as const,
      useDefaultEditorTheme: false,
    }
    expect(normalizeEditorPreferences(withPresetTheme)).toEqual(withPresetTheme)
  })

  it('corrects invalid or out of range fields', () => {
    const invalid = {
      fontSize: 999,
      tabSize: -1,
      wordWrap: 'invalid-wrap',
      minimap: 'not-a-bool',
      appTheme: 'invalid-theme',
      colorMode: 'invalid-mode',
      useDefaultEditorTheme: 123,
    } as unknown
    expect(normalizeEditorPreferences(invalid)).toEqual(DEFAULT_EDITOR_PREFERENCES)
  })
})
