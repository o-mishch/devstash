'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'

export function ThemeInitializer() {
  const { setTheme } = useTheme()
  const appTheme = useEditorPreferencesStore((state) => state.appTheme)
  const isInitialized = useEditorPreferencesStore((state) => state.isInitialized)

  useEffect(() => {
    if (isInitialized) {
      setTheme(appTheme)
    }
  }, [appTheme, isInitialized, setTheme])

  return null
}
