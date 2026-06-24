'use client'

import { useEffect } from 'react'
import { useEditorPreferences } from '@/hooks/editor/use-editor-preferences'

export function ThemeInitializer() {
  const { data: prefs } = useEditorPreferences()

  useEffect(() => {
    // Guard intentional: the root layout already server-renders the correct
    // data-theme and class from the DB, so we must not touch them until
    // EditorPreferencesInitializer seeds the cache (which sets prefs).
    // Overwriting earlier would flash the DEFAULT_EDITOR_PREFERENCES values, not the user's.
    if (!prefs) return

    const root = document.documentElement
    root.setAttribute('data-theme', prefs.appTheme)

    if (prefs.colorMode === 'dark') {
      root.classList.add('dark')
      root.classList.remove('light')
    } else {
      root.classList.add('light')
      root.classList.remove('dark')
    }

    document.cookie = `ds-theme=${encodeURIComponent(`${prefs.appTheme}|${prefs.colorMode}`)}; path=/; max-age=31536000; SameSite=Lax`
    // Persist the skin so the dashboard's route-level loading.tsx can render the matching skin
    // skeleton from a request-synchronous cookie (no DB suspense). Mirrors the ds-theme cookie.
    document.cookie = `ds-skin=${encodeURIComponent(prefs.uiSkin)}; path=/; max-age=31536000; SameSite=Lax`
  }, [prefs])

  return null
}
