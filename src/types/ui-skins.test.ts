import { describe, it, expect } from 'vitest'
import {
  UI_SKINS,
  UI_SKIN_OPTIONS,
  DEFAULT_UI_SKIN,
  SKIN_THEME_PRESET,
  isProSkin,
  resolveAccessibleSkin,
} from './ui-skins'
import { APP_THEMES } from './theme-presets.generated'

describe('ui-skins', () => {
  it('has an option for every skin in UI_SKINS', () => {
    expect(UI_SKIN_OPTIONS.map((o) => o.value).sort()).toEqual([...UI_SKINS].sort())
  })

  it('default skin is classic and is free', () => {
    expect(DEFAULT_UI_SKIN).toBe('classic')
    expect(isProSkin('classic')).toBe(false)
  })

  it('marks the bold skins as Pro', () => {
    expect(isProSkin('mission-control')).toBe(true)
    expect(isProSkin('holographic')).toBe(true)
    expect(isProSkin('aurora')).toBe(false)
    expect(isProSkin('editorial')).toBe(false)
  })

  describe('SKIN_THEME_PRESET', () => {
    it('maps every skin to a paired theme (or null for classic)', () => {
      expect(Object.keys(SKIN_THEME_PRESET).sort()).toEqual([...UI_SKINS].sort())
    })

    it('classic has no paired theme (rides the global appTheme)', () => {
      expect(SKIN_THEME_PRESET.classic).toBeNull()
    })

    it('every non-classic skin maps to a real generated App Theme preset', () => {
      const themes = new Set<string>(APP_THEMES)
      UI_SKINS.filter((skin) => skin !== 'classic').forEach((skin) => {
        const preset = SKIN_THEME_PRESET[skin]
        expect(preset).not.toBeNull()
        expect(themes.has(preset as string)).toBe(true)
      })
    })
  })

  describe('resolveAccessibleSkin', () => {
    it('falls a free user back to the default when their stored skin is Pro-only', () => {
      expect(resolveAccessibleSkin('mission-control', false)).toBe(DEFAULT_UI_SKIN)
    })

    it('lets a Pro user keep a Pro skin', () => {
      expect(resolveAccessibleSkin('mission-control', true)).toBe('mission-control')
    })

    it('leaves free skins untouched for everyone', () => {
      expect(resolveAccessibleSkin('aurora', false)).toBe('aurora')
      expect(resolveAccessibleSkin('aurora', true)).toBe('aurora')
    })
  })
})
