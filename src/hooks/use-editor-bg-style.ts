import { useEditorPreferencesStore } from '@/stores/editor-preferences'

export interface EditorBgStyle {
  backgroundColor: string
  color: string
}

/**
 * Returns a style object for editor chrome surfaces.
 * When useDefaultEditorTheme is true, uses hardcoded Monaco-native colours so the
 * background responds immediately to colorMode changes from the store (before
 * ThemeInitializer's useEffect has a chance to update CSS vars on <html>).
 * When false, uses CSS variables so the surface follows the active preset.
 */
export function useEditorBgStyle(): EditorBgStyle {
  const colorMode = useEditorPreferencesStore((state) => state.colorMode)
  const useDefaultEditorTheme = useEditorPreferencesStore((state) => state.useDefaultEditorTheme)

  if (useDefaultEditorTheme) {
    return {
      backgroundColor: colorMode === 'dark' ? '#1e1e1e' : '#ffffff',
      color: colorMode === 'dark' ? '#d4d4d4' : '#000000',
    }
  }

  return {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
  }
}
