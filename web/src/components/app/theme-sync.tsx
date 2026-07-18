import { useEffect } from 'react'
import { useEditorPreferences } from '@/hooks/use-preferences'
import { applyTheme, themeFromPreferences } from '@/lib/theme'

/**
 * Applies the user's saved App Theme + color mode to <html> whenever preferences load or
 * change (e.g. from the settings switcher, via the optimistic cache write). Renders nothing.
 * Mounted inside the authenticated shell — preferences require a session, and signed-out
 * marketing/auth pages keep the default dark modern-minimal set on <html> in __root.
 */
export function ThemeSync(): null {
  const { data } = useEditorPreferences()
  useEffect(() => {
    if (!data) return
    const { appTheme, colorMode } = themeFromPreferences(data)
    applyTheme(appTheme, colorMode)
  }, [data])
  return null
}
