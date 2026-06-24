import { useResolvedEditorPreferences } from '@/hooks/editor/use-editor-preferences'

export interface EditorBgStyle {
  backgroundColor: string
  color: string
}

const MONACO_DARK: EditorBgStyle = { backgroundColor: '#1e1e1e', color: '#d4d4d4' }
const MONACO_LIGHT: EditorBgStyle = { backgroundColor: '#ffffff', color: '#000000' }
const APP_THEME: EditorBgStyle = { backgroundColor: 'var(--background)', color: 'var(--foreground)' }

/**
 * Returns a style object for editor chrome surfaces.
 * 'app'  — follows the active app theme CSS vars
 * 'auto' — Monaco native colours that track the global color mode
 * 'dark' — Monaco native dark colours regardless of color mode
 *
 * Using hardcoded colours for non-app modes so the background responds
 * immediately to colorMode changes from the store (before ThemeInitializer's
 * useEffect has a chance to update CSS vars on <html>).
 */
export function useEditorBgStyle(): EditorBgStyle {
  const { colorMode, editorThemeMode } = useResolvedEditorPreferences()

  if (editorThemeMode === 'dark') return MONACO_DARK
  if (editorThemeMode === 'auto') return colorMode === 'dark' ? MONACO_DARK : MONACO_LIGHT
  return APP_THEME
}
