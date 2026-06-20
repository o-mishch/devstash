'use client'

import { useEffect } from 'react'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'

export function ThemeInitializer() {
  const appTheme = useEditorPreferencesStore((state) => state.appTheme)
  const colorMode = useEditorPreferencesStore((state) => state.colorMode)
  const uiSkin = useEditorPreferencesStore((state) => state.uiSkin)
  const isInitialized = useEditorPreferencesStore((state) => state.isInitialized)

  useEffect(() => {
    // The guard is intentional: the root layout already server-renders the correct
    // data-theme and class from the DB, so we must not touch them until
    // EditorPreferencesInitializer calls setPreferences() (which sets isInitialized=true).
    // Overwriting earlier would flash the DEFAULT_EDITOR_PREFERENCES values, not the user's.
    if (!isInitialized) return

    const root = document.documentElement
    root.setAttribute('data-theme', appTheme)

    if (colorMode === 'dark') {
      root.classList.add('dark')
      root.classList.remove('light')
    } else {
      root.classList.add('light')
      root.classList.remove('dark')
    }

    document.cookie = `ds-theme=${encodeURIComponent(`${appTheme}|${colorMode}`)}; path=/; max-age=31536000; SameSite=Lax`
    // Persist the skin so the dashboard's route-level loading.tsx can render the matching skin
    // skeleton from a request-synchronous cookie (no DB suspense). Mirrors the ds-theme cookie.
    document.cookie = `ds-skin=${encodeURIComponent(uiSkin)}; path=/; max-age=31536000; SameSite=Lax`
  }, [appTheme, colorMode, uiSkin, isInitialized])

  return null
}
